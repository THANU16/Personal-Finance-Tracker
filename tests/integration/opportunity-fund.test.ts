import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { saveTarget } from "@/modules/allocation/service";
import { setEarmark } from "@/modules/earmarks/service";
import { EarmarkModel } from "@/modules/earmarks/model";
import { OpportunityDeploymentModel } from "@/modules/opportunity-fund/model";
import {
  addMarketLevel,
  deleteMarketLevel,
  detectOpportunityTriggers,
  getOpportunityOverview,
  previewDeployment,
  recordDeployment,
  saveFundSettings,
  undoDeployment,
} from "@/modules/opportunity-fund/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { voidTransaction } from "@/modules/transactions/service";
import { AppError } from "@/server/errors";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import type { Ctx } from "@/server/ctx";
import {
  assetClassId,
  balanceOf,
  holdingDoc,
  makeAccount,
  makeHolding,
  makeUser,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);

/** Bank 350,000 with a 200,000 opportunity earmark; target 60/40 over two equity holdings. */
async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { name: "Commercial Bank", openingBalanceMinor: 35_000_000 });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "opportunity",
    mode: "fixed",
    amountMinor: 20_000_000,
  });
  const equity = await assetClassId(ctx, "Equity");
  const a = await makeHolding(ctx, { name: "Fund A", assetClassId: equity });
  const b = await makeHolding(ctx, { name: "Fund B", assetClassId: equity });
  await saveTarget(ctx, {
    allocation: [
      {
        assetClassId: equity,
        percentBp: 10_000,
        assets: [
          { holdingId: a.id, percentBp: 6000 },
          { holdingId: b.id, percentBp: 4000 },
        ],
      },
    ],
    thresholdBp: 500,
  });
  await saveFundSettings(ctx, {
    benchmarkName: "ASPI",
    targetSizeMinor: 50_000_000,
    rules: [{ drawdownBp: 1000, deployPercentBp: 2500 }],
    allocationSource: "target",
    allocation: null,
    defaultSourceAccountId: null,
  });
  return { ctx, bank, a, b, equity };
}

async function opportunityEarmark(ctx: Ctx, accountId: string) {
  const e = await EarmarkModel.findOne({
    userId: uid(ctx),
    accountId: new Types.ObjectId(accountId),
    bucket: "opportunity",
  }).lean();
  return e?.amountMinor ?? 0;
}

async function deploy(ctx: Ctx, sourceAccountId: string, amountMinor: number, feeMinor = 0) {
  const lines = (await previewDeployment(ctx, { amountMinor })).map((l, i) => ({
    ...l,
    feeMinor: i === 0 ? feeMinor : 0,
  }));
  return recordDeployment(ctx, { date: "2026-03-01", sourceAccountId, lines });
}

describe("opportunity fund", () => {
  it("earmark example: 200,000, rule −10% → 25% suggests 50,000; deploying takes it to 150,000", async () => {
    const { ctx, bank, a, b } = await setup();
    let o = await getOpportunityOverview(ctx);
    expect(o.fundBalanceMinor).toBe(20_000_000);
    expect(o.suggestion.amountMinor).toBe(0);

    await addMarketLevel(ctx, { date: "2026-01-10", level: 12_000 });
    await addMarketLevel(ctx, { date: "2026-02-10", level: 10_680 }); // −11%
    o = await getOpportunityOverview(ctx);
    expect(o.cycle).toMatchObject({
      startedAt: "2026-01-10",
      fundBalanceAtStartMinor: 20_000_000,
      referenceHigh: 12_000,
      drawdownBp: 1100,
      triggered: [0],
    });
    expect(o.suggestion).toEqual({ amountMinor: 5_000_000, ruleIdx: 0 });
    expect(o.sources.map((s) => [s.name, s.opportunityMinor])).toEqual([
      ["Commercial Bank", 20_000_000],
    ]);

    const preview = await previewDeployment(ctx, { amountMinor: 5_000_000 });
    expect(preview.map((l) => [l.holdingId, l.amountMinor])).toEqual([
      [a.id, 3_000_000],
      [b.id, 2_000_000],
    ]);
    const d = await deploy(ctx, bank.id, 5_000_000);
    expect(d).toMatchObject({
      amountMinor: 5_000_000,
      ruleIdx: 0,
      drawdownBpAtDeploy: 1100,
      marketLevel: 10_680,
    });

    expect(await opportunityEarmark(ctx, bank.id)).toBe(15_000_000);
    expect(await balanceOf(ctx, bank.id)).toBe(30_000_000);
    expect((await holdingDoc(ctx, a.id)).investedMinor).toBe(3_000_000);
    const txns = await TransactionModel.find({
      userId: uid(ctx),
      "source.kind": "opportunity_deployment",
    }).lean<TransactionDoc[]>();
    expect(txns).toHaveLength(2);
    expect(new Set(txns.map((t) => String(t.groupId))).size).toBe(1);

    o = await getOpportunityOverview(ctx);
    expect(o.fundBalanceMinor).toBe(15_000_000);
    expect(o.cycle.deployedThisCycleMinor).toBe(5_000_000);
    expect(o.suggestion.amountMinor).toBe(0);
    expect(o.deployments).toHaveLength(1);
  });

  it("worked example: fund 1,000,000; −12% → 250,000; −21% with 250,000 deployed → 250,000 more", async () => {
    const ctx = await makeUser();
    const fundAcc = await makeAccount(ctx, {
      name: "Opportunity",
      type: "opportunity_fund",
      openingBalanceMinor: 100_000_000,
    });
    const equity = await assetClassId(ctx, "Equity");
    const h = await makeHolding(ctx, { name: "Index fund", assetClassId: equity });
    await saveFundSettings(ctx, {
      benchmarkName: "ASPI",
      targetSizeMinor: null,
      rules: [
        { drawdownBp: 1000, deployPercentBp: 2500 },
        { drawdownBp: 2000, deployPercentBp: 5000 },
        { drawdownBp: 3000, deployPercentBp: 10_000 },
      ],
      allocationSource: "custom",
      allocation: [
        {
          assetClassId: equity,
          percentBp: 10_000,
          assets: [{ holdingId: h.id, percentBp: 10_000 }],
        },
      ],
      defaultSourceAccountId: fundAcc.id,
    });
    await addMarketLevel(ctx, { date: "2026-01-05", level: 10_000 });
    await addMarketLevel(ctx, { date: "2026-02-05", level: 8_800 });
    expect((await getOpportunityOverview(ctx)).suggestion.amountMinor).toBe(25_000_000);
    await deploy(ctx, fundAcc.id, 25_000_000);
    expect(await balanceOf(ctx, fundAcc.id)).toBe(75_000_000);

    await addMarketLevel(ctx, { date: "2026-02-20", level: 7_900 });
    const o = await getOpportunityOverview(ctx);
    expect(o.cycle.triggered).toEqual([0, 1]);
    expect(o.suggestion).toEqual({ amountMinor: 25_000_000, ruleIdx: 1 });
    // Dedicated account: no earmark is touched.
    expect(await EarmarkModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect((await detectOpportunityTriggers(ctx)).map((t) => t.dedupeKey)).toEqual([
      "opp:2026-01-05:0",
      "opp:2026-01-05:1",
    ]);

    // A new high resets the cycle with the fund balance at that moment.
    await addMarketLevel(ctx, { date: "2026-03-05", level: 10_500 });
    const reset = await getOpportunityOverview(ctx);
    expect(reset.cycle).toMatchObject({
      startedAt: "2026-03-05",
      fundBalanceAtStartMinor: 75_000_000,
      triggered: [],
      deployedThisCycleMinor: 0,
    });
    expect(reset.suggestion.amountMinor).toBe(0);

    // Deleting the new high replays back into the old cycle.
    const high = reset.levels.find((l) => l.date === "2026-03-05")!;
    await deleteMarketLevel(ctx, high.id);
    expect((await getOpportunityOverview(ctx)).cycle.triggered).toEqual([0, 1]);
  });

  it("undo voids the lines, restores the earmark and leaves caches consistent", async () => {
    const { ctx, bank, a } = await setup();
    await addMarketLevel(ctx, { date: "2026-01-10", level: 12_000 });
    await addMarketLevel(ctx, { date: "2026-02-10", level: 10_680 });
    const d = await deploy(ctx, bank.id, 5_000_000, 10_000);
    expect(await opportunityEarmark(ctx, bank.id)).toBe(14_990_000); // amount + fee left the fund
    expect(await balanceOf(ctx, bank.id)).toBe(29_990_000);

    // Lines are owner-managed: they cannot be voided one by one.
    const txn = await TransactionModel.findOne({
      userId: uid(ctx),
      "source.kind": "opportunity_deployment",
    }).lean<TransactionDoc>();
    const err = await voidTransaction(ctx, String(txn!._id), { reason: "x" }).catch(
      (e: unknown) => e,
    );
    expect((err as AppError).code).toBe("FORBIDDEN");

    await undoDeployment(ctx, d.id);
    expect(await balanceOf(ctx, bank.id)).toBe(35_000_000);
    expect(await opportunityEarmark(ctx, bank.id)).toBe(20_000_000);
    expect((await holdingDoc(ctx, a.id)).investedMinor).toBe(0);
    const o = await getOpportunityOverview(ctx);
    expect(o.deployments[0]!.status).toBe("undone");
    expect(o.cycle.deployedThisCycleMinor).toBe(0);
    expect(o.suggestion.amountMinor).toBe(5_000_000);
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);
    await expect(undoDeployment(ctx, d.id)).rejects.toThrow(/already undone/);
  });

  it("refuses more than the account's opportunity money and leaves nothing on failure", async () => {
    const { ctx, bank } = await setup();
    const tooMuch = await deploy(ctx, bank.id, 20_000_001).catch((e: unknown) => e);
    expect((tooMuch as AppError).message).toMatch(/opportunity money/);

    // The ledger refuses inside the DB transaction (dated before the account opened): nothing stays.
    const lines = await previewDeployment(ctx, { amountMinor: 1_000_000 });
    await expect(
      recordDeployment(ctx, { date: "2025-06-01", sourceAccountId: bank.id, lines }),
    ).rejects.toThrow(/opened/);
    // A line on a closed holding is rejected before posting.
    const { HoldingModel } = await import("@/modules/holdings/model");
    await HoldingModel.updateOne(
      { _id: new Types.ObjectId(lines[1]!.holdingId!), userId: uid(ctx) },
      { $set: { status: "closed" } },
    );
    await expect(
      recordDeployment(ctx, { date: "2026-03-01", sourceAccountId: bank.id, lines }),
    ).rejects.toThrow(/closed/);
    expect(
      await TransactionModel.countDocuments({
        userId: uid(ctx),
        "source.kind": "opportunity_deployment",
      }),
    ).toBe(0);
    expect(await OpportunityDeploymentModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    expect(await opportunityEarmark(ctx, bank.id)).toBe(20_000_000);
  });

  it("validates rules and settings", async () => {
    const { ctx } = await setup();
    const err = await saveFundSettings(ctx, {
      benchmarkName: "ASPI",
      targetSizeMinor: null,
      rules: [
        { drawdownBp: 2000, deployPercentBp: 5000 },
        { drawdownBp: 1000, deployPercentBp: 2500 },
      ],
      allocationSource: "custom",
      allocation: [],
      defaultSourceAccountId: null,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(Object.keys((err as AppError).fieldErrors ?? {})).toEqual(
      expect.arrayContaining(["rules.1.drawdownBp", "rules.1.deployPercentBp", "allocation"]),
    );
    await expect(addMarketLevel(ctx, { date: "2999-01-01", level: 1 })).rejects.toThrow(/future/);
  });
});
