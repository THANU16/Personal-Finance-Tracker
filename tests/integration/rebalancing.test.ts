import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { TargetAllocationHistoryModel } from "@/modules/allocation/model";
import { saveTarget } from "@/modules/allocation/service";
import { getAttention } from "@/modules/dashboard/queries";
import {
  countOffTarget,
  getAllocationView,
  getCashflowPlan,
  getTargetHistory,
  tiltNextSip,
} from "@/modules/rebalancing/service";
import { SipExecutionModel } from "@/modules/sip/model";
import { getExecuteView } from "@/modules/sip/queries";
import { createPlan } from "@/modules/sip/service";
import { AppError } from "@/server/errors";
import { assetClassId, makeAccount, makeHolding, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const TODAY = utcToBusinessDate(new Date(), "Asia/Colombo");

async function scenario() {
  const ctx = await makeUser();
  const eq = await assetClassId(ctx, "Equity");
  const fi = await assetClassId(ctx, "Fixed Income");
  const h = (name: string, cls: string, value: number, extra: object = {}) =>
    makeHolding(ctx, {
      name,
      assetClassId: cls,
      openingDate: "2026-01-01",
      investedMinor: value,
      currentValueMinor: value,
      ...extra,
    });
  const A = await h("A", eq, 50_000_00);
  const B = await h("B", eq, 20_000_00);
  const UT = await h("UT", fi, 30_000_00);
  const tree = [
    {
      assetClassId: eq,
      percentBp: 6_000,
      assets: [
        { holdingId: A.id, percentBp: 5_000 },
        { holdingId: B.id, percentBp: 5_000 },
      ],
    },
    { assetClassId: fi, percentBp: 4_000, assets: [{ holdingId: UT.id, percentBp: 10_000 }] },
  ];
  await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
  return { ctx, eq, fi, A, B, UT, tree, h };
}

describe("allocation view (docs/04 §8)", () => {
  it("drift by class and asset on today's base values; trades sum to zero", async () => {
    const { ctx, A, B } = await scenario();
    const v = await getAllocationView(ctx);
    expect(v.drift.universeValueMinor).toBe(100_000_00);
    expect(v.drift.classes.map((c) => [c.weightBp, c.targetBp, c.driftBp, c.status])).toEqual([
      [7_000, 6_000, 1_000, "over"],
      [3_000, 4_000, -1_000, "under"],
    ]);
    expect(v.drift.classes[0]!.assets.map((a) => [a.holdingId, a.driftBp])).toEqual([
      [A.id, 2_143],
      [B.id, -2_143],
    ]);
    expect(v.trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
    expect(v.trades.map((t) => t.tradeMinor)).toEqual([-20_000_00, 10_000_00, 10_000_00]);
    expect(await countOffTarget(ctx)).toBe(2);
    expect((await getAttention(ctx)).offTargetCount).toBe(2);
  });

  it("emergency-flagged holdings and classes outside the target do not move drift", async () => {
    const { ctx, fi, h } = await scenario();
    const before = await getAllocationView(ctx);
    await h("EF deposit", fi, 900_000_00, { countsTowardEmergencyFund: true });
    await h("Bitcoin", await assetClassId(ctx, "Crypto"), 40_000_00);
    const after = await getAllocationView(ctx);
    expect(after.drift.classes.map((c) => c.driftBp)).toEqual(
      before.drift.classes.map((c) => c.driftBp),
    );
    expect(after.drift.universeValueMinor).toBe(100_000_00);
    expect(after.drift.excludedEmergencyMinor).toBe(900_000_00);
    expect(after.drift.outside).toEqual([
      { assetClassId: await assetClassId(ctx, "Crypto"), valueMinor: 40_000_00 },
    ]);
  });

  it("invest new money only buys and sums to the amount", async () => {
    const { ctx, UT } = await scenario();
    const plan = await getCashflowPlan(ctx, 10_000_00);
    expect(plan.every((l) => l.amountMinor > 0)).toBe(true);
    expect(plan.reduce((s, l) => s + l.amountMinor, 0)).toBe(10_000_00);
    expect(plan).toEqual([
      { assetClassId: expect.any(String), holdingId: UT.id, amountMinor: 10_000_00 },
    ]);
    await expect(getCashflowPlan(ctx, 0)).rejects.toBeInstanceOf(AppError);
  });

  it("saving the target creates a history row; history shows the diff", async () => {
    const { ctx, eq, fi, A, B, UT } = await scenario();
    const uid = new Types.ObjectId(ctx.userId);
    expect(await TargetAllocationHistoryModel.countDocuments({ userId: uid })).toBe(1);
    await saveTarget(ctx, {
      allocation: [
        { assetClassId: eq, percentBp: 7_000, assets: [{ holdingId: A.id, percentBp: 10_000 }] },
        { assetClassId: fi, percentBp: 3_000, assets: [{ holdingId: UT.id, percentBp: 10_000 }] },
      ],
      thresholdBp: 300,
      note: "More equity",
    });
    expect(await TargetAllocationHistoryModel.countDocuments({ userId: uid })).toBe(2);
    const [latest, first] = await getTargetHistory(ctx);
    expect(latest!.note).toBe("More equity");
    expect(latest!.diff).toEqual({
      classes: [
        { assetClassId: eq, fromBp: 6_000, toBp: 7_000 },
        { assetClassId: fi, fromBp: 4_000, toBp: 3_000 },
      ],
      holdingsAdded: [],
      holdingsRemoved: [B.id],
      thresholdFromBp: 500,
    });
    expect(first!.diff.classes).toHaveLength(2); // first save: everything new
  });

  it("an empty target gives an empty view", async () => {
    const ctx = await makeUser();
    const v = await getAllocationView(ctx);
    expect(v.drift.classes).toEqual([]);
    expect(v.trades).toEqual([]);
    expect(await countOffTarget(ctx)).toBe(0);
  });
});

describe("use for next SIP", () => {
  it("marks only that plan's next due period; the execute screen opens tilted", async () => {
    const { ctx } = await scenario();
    const bank = await makeAccount(ctx, {
      openingBalanceMinor: 1_000_000_00,
      openingDate: "2024-01-01",
    });
    const day = Math.min(28, Number(TODAY.slice(8)));
    const input = {
      amountMinor: 10_000_00,
      frequency: "monthly",
      dayOfMonth: day,
      sourceAccountId: bank.id,
      startDate: `${TODAY.slice(0, 8)}${String(day).padStart(2, "0")}`,
    };
    const { plan: p1 } = await createPlan(ctx, { ...input, name: "One" });
    const { plan: p2 } = await createPlan(ctx, { ...input, name: "Two" });
    const next = await tiltNextSip(ctx, p1.id);
    expect(next).toMatchObject({ planId: p1.id, useTilt: true });
    const uid = new Types.ObjectId(ctx.userId);
    expect(await SipExecutionModel.countDocuments({ userId: uid, useTilt: true })).toBe(1);
    expect(
      await SipExecutionModel.countDocuments({
        userId: uid,
        planId: new Types.ObjectId(p2.id),
        useTilt: true,
      }),
    ).toBe(0);
    const view = await getExecuteView(ctx, next.executionId);
    expect(view.execution.useTilt).toBe(true);
    expect(view.tiltedPlanned).not.toBeNull();
    // the tilt sends everything to the underweight Fixed Income class
    expect(view.tiltedPlanned!.reduce((s, x) => s + x, 0)).toBe(view.execution.plannedTotalMinor);
  });
});

describe("isolation", () => {
  it("another user cannot tilt someone else's plan or see their drift", async () => {
    await scenario();
    const other = await makeUser();
    expect((await getAllocationView(other)).drift.universeValueMinor).toBe(0);
    await expect(tiltNextSip(other, new Types.ObjectId().toString())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
