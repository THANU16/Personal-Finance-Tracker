import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { CategoryModel } from "@/modules/categories/model";
import { HoldingModel, ValuationModel, type HoldingDoc } from "@/modules/holdings/model";
import { ImportBatchModel } from "@/modules/imports/model";
import {
  commitImport,
  createMoneyManagerDraft,
  getWizardData,
  previewImport,
  saveImportMapping,
  undoImport,
} from "@/modules/imports/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { AppError } from "@/server/errors";
import { recomputeAccount, recomputeHolding } from "@/server/ledger/recompute";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import type { Ctx } from "@/server/ctx";
import { makeAccount, makeUser } from "../helpers/factories";
import {
  fixtureRows2025,
  fixtureRows2026,
  moneyManagerXlsx,
  type FixtureRow,
} from "../helpers/money-manager-fixture";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);

/** Money Manager's own balance per trimmed account (major units → minor). */
function signedTotals(rows: FixtureRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.account.trim();
    const minor = Math.round(Number(r.amount) * 100);
    const sign = r.type === "Income" || r.type === "Transfer-In" ? 1 : -1;
    out.set(key, (out.get(key) ?? 0) + sign * minor);
  }
  return out;
}

async function upload(ctx: Ctx, rows: FixtureRow[], name = "2025.xlsx") {
  const buffer = await moneyManagerXlsx(rows, name.replace(".xlsx", ""));
  return (await createMoneyManagerDraft(ctx, [{ name, buffer }])).batchId;
}

async function importedTxns(ctx: Ctx) {
  return TransactionModel.find({ userId: uid(ctx), "source.kind": "import" })
    .sort({ createdAt: 1 })
    .lean<TransactionDoc[]>();
}

async function accountsByName(ctx: Ctx) {
  const docs = await AccountModel.find({ userId: uid(ctx) }).lean<AccountDoc[]>();
  return new Map(docs.map((a) => [a.name, a]));
}

async function holdingsByName(ctx: Ctx) {
  const docs = await HoldingModel.find({ userId: uid(ctx) }).lean<HoldingDoc[]>();
  return new Map(docs.map((h) => [h.name, h]));
}

async function importAll(ctx: Ctx, rows = fixtureRows2025(), name = "2025.xlsx") {
  const batchId = await upload(ctx, rows, name);
  const preview = await previewImport(ctx, batchId);
  expect(preview.blockers).toEqual([]);
  const result = await commitImport(ctx, { batchId, confirmReviewed: true });
  return { batchId, preview, result };
}

describe("Money Manager import — draft and wizard data", () => {
  it("parses, pairs transfers, attaches fees and suggests a mapping", async () => {
    const ctx = await makeUser();
    const batchId = await upload(ctx, fixtureRows2025());
    const w = await getWizardData(ctx, batchId);

    expect(w.counts.total).toBe(fixtureRows2025().length);
    expect(w.counts.toImport).toBe(w.counts.total);
    // "Cash In Hand " and "Cash In Hand" are one account.
    expect(w.accounts.map((a) => a.name).sort()).toEqual(
      [
        "Binance",
        "CAL Money Market",
        "Cash In Hand",
        "eZ Cash",
        "From Amma",
        "Give to Others",
        "Sampath Bank",
      ].sort(),
    );
    expect(w.transfers).toHaveLength(7);
    expect(w.transfers.filter((t) => t.fee)).toHaveLength(2);
    // The same-second fee resolved by its description goes to "Give to Others", not eZ Cash.
    const giveTo = w.transfers.find((t) => t.in.account === "Give to Others")!;
    expect(giveTo.fee?.amountMinor).toBe(3000);
    expect(w.standaloneFees.map((f) => f.description)).toEqual(["SMS alerts"]);
    expect(w.differences).toHaveLength(4);
    expect(w.problems).toEqual([]);

    const s = w.state.accounts;
    expect(s["cal money market"]).toMatchObject({ treatAs: "holding", existingId: null });
    expect(s["binance"]).toMatchObject({ treatAs: "holding" });
    expect(s["give to others"]).toMatchObject({
      treatAs: "account",
      create: { type: "receivable" },
    });
    expect(s["from amma"]).toMatchObject({ treatAs: "account", create: { type: "payable" } });
    expect(s["cash in hand"]).toMatchObject({ treatAs: "account", create: { type: "cash" } });
    // Emoji stripped from category names; Income/expense namespaces are separate.
    expect(w.expenseCategories.find((c) => c.key === "food")?.icon).toBe("🍜");
    expect(w.incomeCategories.map((c) => c.key)).toContain("salary");
    expect(w.hints.expense).toContainEqual({ from: "petrol", to: "bike>petrol" });
  });

  it("matches existing accounts by name and rejects non-Money Manager files", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Sampath Bank", openingDate: "2024-01-01" });
    const w = await getWizardData(ctx, await upload(ctx, fixtureRows2025()));
    expect(w.state.accounts["sampath bank"]).toEqual({
      treatAs: "account",
      existingId: bank.id,
      create: null,
    });
    // Seeded "Salary" income category is matched rather than duplicated.
    expect(w.state.incomeCategories["salary"]).toMatchObject({ action: "existing" });

    const err = await createMoneyManagerDraft(ctx, [
      { name: "notes.xlsx", buffer: Buffer.from("not a spreadsheet") },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("VALIDATION");
  });
});

describe("Money Manager import — commit", () => {
  it("posts every row and balances equal Money Manager's signed totals", async () => {
    const ctx = await makeUser();
    const rows = fixtureRows2025();
    const { preview, result } = await importAll(ctx);

    for (const line of preview.balances) {
      expect(line.wealthTrackMinor, line.name).toBe(line.moneyManagerMinor);
    }
    // 7 incomes/expenses... counted by type below; fees: 2 attached, 1 standalone.
    const txns = await importedTxns(ctx);
    expect(result.transactions).toBe(txns.length);
    const byType = (t: string) => txns.filter((x) => x.type === t).length;
    expect(byType("transfer")).toBe(4); // ATM, Give to Others, eZ Cash, From Amma → Cash
    expect(byType("invest")).toBe(2); // Sampath → CAL, Binance → CAL (holding → holding)
    expect(byType("redeem")).toBe(2); // CAL → Sampath, Binance → CAL
    expect(byType("adjustment")).toBe(2); // Difference on Cash and on Sampath
    expect(byType("opening_balance")).toBe(1); // Binance's first Difference
    expect(txns.filter((t) => t.type === "transfer" && t.feeMinor > 0)).toHaveLength(2);
    const fees = txns.filter((t) => t.type === "expense" && t.description === "SMS alerts");
    expect(fees).toHaveLength(1);
    expect(txns.every((t) => t.importHash && t.source.refId)).toBe(true);

    // Holding → holding shares a group and needs no account.
    const grouped = txns.filter((t) => t.groupId);
    expect(grouped).toHaveLength(2);
    expect(String(grouped[0]!.groupId)).toBe(String(grouped[1]!.groupId));
    expect(grouped.every((t) => !t.fromAccountId && !t.toAccountId)).toBe(true);

    // Entry order is preserved for same-day replay.
    const created = txns.map((t) => t.createdAt.getTime());
    expect([...created].sort((a, b) => a - b)).toEqual(created);

    const expected = signedTotals(rows);
    const accounts = await accountsByName(ctx);
    for (const name of ["Sampath Bank", "Cash In Hand", "eZ Cash", "Give to Others", "From Amma"]) {
      expect(accounts.get(name)?.balanceMinor, name).toBe(expected.get(name));
    }
    expect(accounts.get("Cash In Hand")?.type).toBe("cash");
    const holdings = await holdingsByName(ctx);
    expect(holdings.get("Binance")?.currentValueMinor).toBe(3_000_000);
    expect(holdings.get("CAL Money Market")?.currentValueMinor).toBe(1_000_000);
    const valuations = await ValuationModel.find({ userId: uid(ctx), source: "import" }).lean();
    expect(valuations.length).toBeGreaterThanOrEqual(3);

    const batch = await ImportBatchModel.findOne({ userId: uid(ctx) }).lean();
    expect(batch?.status).toBe("imported");
    expect(batch?.createdItems.accountIds).toHaveLength(5);
    expect(batch?.createdItems.holdingIds).toHaveLength(2);

    // recompute-all is idempotent.
    for (const a of accounts.values()) {
      const r = await recomputeAccount(uid(ctx), a._id, null);
      expect(r.afterMinor).toBe(r.beforeMinor);
    }
    for (const h of holdings.values()) {
      const s = await recomputeHolding(ctx, h._id, null);
      expect(s.currentValueMinor).toBe(h.currentValueMinor);
    }
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);
  });

  it("re-importing the same file adds 0 rows; a later file adds only its new rows", async () => {
    const ctx = await makeUser();
    await importAll(ctx);
    const before = (await importedTxns(ctx)).length;

    const again = await upload(ctx, fixtureRows2025());
    const w = await getWizardData(ctx, again);
    expect(w.counts.toImport).toBe(0);
    const err = await commitImport(ctx, { batchId: again, confirmReviewed: true }).catch(
      (e: unknown) => e,
    );
    expect((err as AppError).message).toMatch(/Nothing new/);
    expect((await importedTxns(ctx)).length).toBe(before);

    // The 2026 file overlaps by one row; saved mappings point at the accounts created last time.
    const next = await upload(ctx, fixtureRows2026(), "2026.xlsx");
    const w2 = await getWizardData(ctx, next);
    expect(w2.counts.alreadyImported).toBe(1);
    const accounts = await accountsByName(ctx);
    expect(w2.state.accounts["sampath bank"]).toMatchObject({
      existingId: String(accounts.get("Sampath Bank")!._id),
    });
    expect(w2.state.expenseCategories["food>lunch"]).toMatchObject({ action: "existing" });
    const preview = await previewImport(ctx, next);
    expect(preview.blockers).toEqual([]);
    expect(preview.create.accounts).toEqual([]);
    const result = await commitImport(ctx, { batchId: next, confirmReviewed: true });
    expect(result.transactions).toBe(2);
    const food = await CategoryModel.countDocuments({ userId: uid(ctx), name: "Food" });
    expect(food).toBe(1);
  });

  it("undo voids the batch, removes its valuations and can archive what it created", async () => {
    const ctx = await makeUser();
    const { batchId } = await importAll(ctx);
    const res = await undoImport(ctx, { batchId, archiveCreated: true });
    expect(res.voided).toBeGreaterThan(0);

    const txns = await importedTxns(ctx);
    expect(txns.every((t) => t.status === "void")).toBe(true);
    expect(await ValuationModel.countDocuments({ userId: uid(ctx), source: "import" })).toBe(0);
    const accounts = await accountsByName(ctx);
    for (const a of accounts.values()) {
      expect(a.balanceMinor).toBe(0);
      expect(a.archivedAt).not.toBeNull();
    }
    for (const h of (await holdingsByName(ctx)).values()) {
      expect(h.currentValueMinor).toBe(0);
      expect(h.investedMinor).toBe(0);
      expect(h.status).toBe("closed");
    }
    expect(
      (await ImportBatchModel.findOne({ _id: batchId, userId: uid(ctx) }).lean())?.status,
    ).toBe("reverted");
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);

    // The same file can be imported again after an undo.
    const { result } = await importAll(ctx);
    expect(result.transactions).toBe(txns.length);
  });

  it("a failure during commit leaves nothing behind", async () => {
    const ctx = await makeUser();
    const batchId = await upload(ctx, fixtureRows2025());
    expect((await previewImport(ctx, batchId)).blockers).toEqual([]);
    // Break the ledger mid-commit (after accounts are created): its system category is gone.
    await CategoryModel.deleteOne({ userId: uid(ctx), name: "Bank fees", isSystem: true });

    await expect(commitImport(ctx, { batchId, confirmReviewed: true })).rejects.toThrow();
    expect(await AccountModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(await HoldingModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(await TransactionModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(
      (await ImportBatchModel.findOne({ _id: batchId, userId: uid(ctx) }).lean())?.status,
    ).toBe("previewed");
  });

  it("blocks rows older than an existing account until its opening date moves", async () => {
    const ctx = await makeUser();
    await makeAccount(ctx, { name: "Sampath Bank", openingDate: "2025-01-03" });
    const batchId = await upload(ctx, fixtureRows2025());
    const blocked = await previewImport(ctx, batchId);
    expect(blocked.blockers.join(" ")).toMatch(/before its opening date/);

    const w = await getWizardData(ctx, batchId);
    const line = blocked.balances.find((b) => b.name === "Sampath Bank")!;
    await saveImportMapping(ctx, {
      batchId,
      state: { ...w.state, openings: { [line.ref]: { date: "2025-01-01", balanceMinor: 0 } } },
    });
    expect((await previewImport(ctx, batchId)).blockers).toEqual([]);
    await commitImport(ctx, { batchId, confirmReviewed: true });
    const bank = (await accountsByName(ctx)).get("Sampath Bank")!;
    expect(bank.balanceMinor).toBe(signedTotals(fixtureRows2025()).get("Sampath Bank"));
  });
});
