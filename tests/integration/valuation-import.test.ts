import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { dayEnds, detectJumps, orderRows, parseValuationCsv } from "@/domain/valuation-import";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { HoldingModel, ValuationModel } from "@/modules/holdings/model";
import { ImportBatchModel } from "@/modules/imports/model";
import {
  EXTERNAL_FUNDING_NAME,
  analyzeValuationFile,
  commitValuationImport,
  listImportHistory,
  undoValuationImport,
} from "@/modules/imports/valuation-service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { AppError } from "@/server/errors";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import type { Ctx } from "@/server/ctx";
import { assetClassId, holdingDoc, makeAccount, makeHolding, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const csvText = readFileSync(
  join(process.cwd(), "tests/fixtures/valuations-cse-stock.csv"),
  "utf8",
);
const fileName = "CSE Stock - valuations 2026-10-18.csv";
const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);

/** The four real flows of the fixture; every other flagged jump is a market move. */
function choices() {
  const jumps = detectJumps(dayEnds(orderRows(parseValuationCsv(csvText, "LKR").rows)), {
    thresholdBp: 1000,
    currency: "LKR",
  });
  const real: Record<string, { action: "deposit" | "withdrawal"; amountMinor: number }> = {
    "2026-03-29>2026-03-31": { action: "deposit", amountMinor: 5_000_000 },
    "2026-04-28>2026-04-29": { action: "withdrawal", amountMinor: 5_000_000 },
    "2026-07-22>2026-07-24": { action: "deposit", amountMinor: 7_400_000 },
    "2026-09-16>2026-09-17": { action: "deposit", amountMinor: 3_000_000 },
  };
  return Object.fromEntries(
    jumps.map((j) => [
      j.key,
      real[j.key]
        ? { ...real[j.key]!, date: j.toDate }
        : { action: "market" as const, amountMinor: 0, date: j.toDate },
    ]),
  );
}

async function importNew(ctx: Ctx) {
  return commitValuationImport(ctx, {
    fileName,
    csvText,
    holding: {
      create: {
        name: "CSE Stock",
        assetClassId: await assetClassId(ctx, "Equity"),
        instrumentType: "stock",
        liquidity: "medium",
      },
    },
    funding: { createExternal: true },
    firstAsInvestment: true,
    thresholdBp: 1000,
    choices: choices(),
  });
}

const fundingOf = async (ctx: Ctx) =>
  AccountModel.findOne({ userId: uid(ctx), name: EXTERNAL_FUNDING_NAME }).lean<AccountDoc>();

describe("valuation CSV import", () => {
  it("imports every row and the chosen flows; invested and gain match the hand calculation", async () => {
    const ctx = await makeUser();
    const r = await importNew(ctx);
    expect(r).toMatchObject({
      valuations: 45,
      duplicates: 0,
      errors: 0,
      deposits: 4,
      withdrawals: 1,
    });

    const h = await holdingDoc(ctx, r.holdingId);
    expect(h.currentValueMinor).toBe(33_608_300);
    // 50,000 + 50,000 − 50,000 (withdrawal returns capital) + 74,000 + 30,000 (see the unit test)
    expect(h.investedMinor).toBe(15_400_000);
    expect(h.currentValueMinor - h.investedMinor).toBe(18_208_300);
    expect(h.realizedGainMinor).toBe(0);

    const vals = await ValuationModel.find({ userId: uid(ctx), holdingId: h._id }).lean();
    expect(vals).toHaveLength(45);
    expect(vals.every((v) => v.source === "import" && v.importHash && v.importBatchId)).toBe(true);
    expect(vals.find((v) => v.valueMinor === 33_873_845)?.recordedAt?.toISOString()).toBe(
      "2026-10-11T19:17:53.000Z",
    );

    const funding = (await fundingOf(ctx))!;
    expect(funding).toMatchObject({ type: "cash", includeInNetWorth: false });
    expect(funding.balanceMinor).toBe(-(5_000_000 + 5_000_000 + 7_400_000 + 3_000_000) + 5_000_000);
    const txns = await TransactionModel.find({ userId: uid(ctx), "source.kind": "import" }).lean<
      TransactionDoc[]
    >();
    expect(txns.map((t) => t.type).sort()).toEqual([
      "invest",
      "invest",
      "invest",
      "invest",
      "redeem",
    ]);
    expect(txns.every((t) => String(t.source.refId) === r.batchId)).toBe(true);
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);

    const history = await listImportHistory(ctx);
    expect(history[0]).toMatchObject({
      kind: "valuations",
      status: "imported",
      holding: { name: "CSE Stock" },
    });
  });

  it("re-importing the same file adds 0 rows", async () => {
    const ctx = await makeUser();
    const r = await importNew(ctx);
    const analysis = await analyzeValuationFile(ctx, { fileName, csvText, holdingId: r.holdingId });
    expect(analysis.duplicateLines).toHaveLength(45);
    expect(analysis.suggestedHoldingId).toBe(r.holdingId);
    const again = await commitValuationImport(ctx, {
      fileName,
      csvText,
      holding: { existingId: r.holdingId },
      funding: null,
      firstAsInvestment: true,
      choices: {},
    }).catch((e: unknown) => e);
    expect((again as AppError).message).toMatch(/Nothing new/);
    expect(await ValuationModel.countDocuments({ userId: uid(ctx) })).toBe(45);
  });

  it("undo restores the holding and the funding account exactly; the file can be imported again", async () => {
    const ctx = await makeUser();
    const holding = await makeHolding(ctx, {
      name: "CSE Stock",
      investedMinor: 0,
      currentValueMinor: 0,
    });
    const bank = await makeAccount(ctx, {
      name: "Bank",
      openingBalanceMinor: 100_000_000,
      openingDate: "2025-01-01",
    });
    const before = {
      h: await holdingDoc(ctx, holding.id),
      bank: (await AccountModel.findById(bank.id)
        .setOptions({ skipUserIdGuard: true })
        .lean<AccountDoc>())!,
    };
    const r = await commitValuationImport(ctx, {
      fileName,
      csvText,
      holding: { existingId: holding.id },
      funding: { existingId: bank.id },
      firstAsInvestment: true,
      choices: choices(),
    });
    expect((await holdingDoc(ctx, holding.id)).currentValueMinor).toBe(33_608_300);
    await undoValuationImport(ctx, r.batchId);
    const h = await holdingDoc(ctx, holding.id);
    expect({
      invested: h.investedMinor,
      value: h.currentValueMinor,
      realised: h.realizedGainMinor,
    }).toEqual({
      invested: before.h.investedMinor,
      value: before.h.currentValueMinor,
      realised: before.h.realizedGainMinor,
    });
    const bankAfter = (await AccountModel.findOne({
      _id: bank.id,
      userId: uid(ctx),
    }).lean<AccountDoc>())!;
    expect(bankAfter.balanceMinor).toBe(before.bank.balanceMinor);
    expect(await ValuationModel.countDocuments({ userId: uid(ctx), source: "import" })).toBe(0);
    expect(
      (await ImportBatchModel.findOne({ _id: r.batchId, userId: uid(ctx) }).lean())?.status,
    ).toBe("reverted");
    await expect(undoValuationImport(ctx, r.batchId)).rejects.toThrow(/already undone/);
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);

    const again = await commitValuationImport(ctx, {
      fileName,
      csvText,
      holding: { existingId: holding.id },
      funding: { existingId: bank.id },
      firstAsInvestment: true,
      choices: choices(),
    });
    expect(again.valuations).toBe(45);
  });

  it("keeps users apart", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const r = await importNew(a);
    await expect(
      analyzeValuationFile(b, { fileName, csvText, holdingId: r.holdingId }),
    ).rejects.toThrow(/not found/i);
    await expect(
      commitValuationImport(b, {
        fileName,
        csvText,
        holding: { existingId: r.holdingId },
        funding: null,
        firstAsInvestment: false,
        choices: {},
      }),
    ).rejects.toThrow(/not found/i);
    await expect(undoValuationImport(b, r.batchId)).rejects.toThrow(/not found/i);
    // B importing the same file into its own holding is not a duplicate of A's rows.
    const mine = await importNew(b);
    expect(mine.valuations).toBe(45);
  });

  it("a failure mid-commit leaves nothing written", async () => {
    const ctx = await makeUser();
    // Opens after the first deposit: refused after the new holding was already created.
    const late = await makeAccount(ctx, { name: "New bank", openingDate: "2026-06-01" });
    const err = await commitValuationImport(ctx, {
      fileName,
      csvText,
      holding: {
        create: {
          name: "CSE Stock",
          assetClassId: await assetClassId(ctx, "Equity"),
          instrumentType: "stock",
          liquidity: "medium",
        },
      },
      funding: { existingId: late.id },
      firstAsInvestment: true,
      choices: choices(),
    }).catch((e: unknown) => e);
    expect((err as AppError).message).toMatch(/opens on 2026-06-01/);
    expect(await HoldingModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(await ValuationModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(await ImportBatchModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(await TransactionModel.countDocuments({ userId: uid(ctx) })).toBe(0);
  });

  it("an invest already recorded near a jump defaults it to a market move", async () => {
    const ctx = await makeUser();
    const holding = await makeHolding(ctx, {
      name: "CSE",
      investedMinor: 0,
      currentValueMinor: 0,
      openingDate: "2025-01-01",
    });
    const bank = await makeAccount(ctx, {
      name: "Bank",
      openingBalanceMinor: 100_000_000,
      openingDate: "2025-01-01",
    });
    const { post } = await import("../helpers/factories");
    await post(ctx, {
      type: "invest",
      date: "2026-03-30",
      amountMinor: 5_000_000,
      fromAccountId: bank.id,
      holdingId: holding.id,
    });
    const a = await analyzeValuationFile(ctx, { fileName, csvText, holdingId: holding.id });
    expect(a.holding?.hasInitialTransactions).toBe(true);
    const jumps = detectJumps(dayEnds(orderRows(a.rows)), {
      thresholdBp: 1000,
      currency: "LKR",
      existingFlows: a.holding!.existingFlows,
    });
    expect(jumps.find((j) => j.key === "2026-03-29>2026-03-31")).toMatchObject({
      alreadyRecorded: true,
      action: "market",
    });
  });
});
