import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { getTarget, saveTarget } from "@/modules/allocation/service";
import { getAccountBuckets } from "@/modules/earmarks/service";
import { getHoldingBuckets } from "@/modules/earmarks/holding-service";
import { SipExecutionModel, type SipExecutionDoc } from "@/modules/sip/model";
import { createPlan, executeSip, undoSip } from "@/modules/sip/service";
import { TransactionModel } from "@/modules/transactions/model";
import { AppError } from "@/server/errors";
import type { Ctx } from "@/server/ctx";
import { assetClassId, balanceOf, makeAccount, makeHolding, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

// docs/04 §6–§7 — a SIP's opportunity-fund share (owner request, 2026-11-07):
// 100,000 = Equity 60 · Fixed income 20 · Gold 10 · Opportunity 10.
const TODAY = utcToBusinessDate(new Date(), "Asia/Colombo");
const DAY = Math.min(28, Number(TODAY.slice(8)));

async function setup() {
  const ctx = await makeUser();
  const hnb = await makeAccount(ctx, {
    name: "HNB",
    openingBalanceMinor: 1_000_000_00,
    openingDate: "2024-01-01",
  });
  const h = async (name: string, cls: string) =>
    makeHolding(ctx, {
      name,
      assetClassId: await assetClassId(ctx, cls),
      openingDate: "2024-01-01",
      investedMinor: 0,
      currentValueMinor: 0,
    });
  const EQ = await h("Equity fund", "Equity");
  const FI = await h("Bond fund", "Fixed Income");
  const AU = await h("Gold", "Gold");
  const MMF = await h("Money market", "Fixed Income");
  await saveTarget(ctx, {
    thresholdBp: 500,
    opportunityBp: 1_000,
    allocation: [
      {
        assetClassId: await assetClassId(ctx, "Equity"),
        percentBp: 6_000,
        assets: [{ holdingId: EQ.id, percentBp: 10_000 }],
      },
      {
        assetClassId: await assetClassId(ctx, "Fixed Income"),
        percentBp: 2_000,
        assets: [{ holdingId: FI.id, percentBp: 10_000 }],
      },
      {
        assetClassId: await assetClassId(ctx, "Gold"),
        percentBp: 1_000,
        assets: [{ holdingId: AU.id, percentBp: 10_000 }],
      },
    ],
  });
  const { plan } = await createPlan(ctx, {
    name: "Monthly SIP",
    amountMinor: 100_000_00,
    frequency: "monthly",
    dayOfMonth: DAY,
    sourceAccountId: hnb.id,
    startDate: TODAY.slice(0, 8) + String(DAY).padStart(2, "0"),
  });
  const [e] = await SipExecutionModel.find({
    userId: new Types.ObjectId(ctx.userId),
    planId: new Types.ObjectId(plan.id),
  })
    .sort({ dueDate: 1 })
    .lean<SipExecutionDoc[]>();
  return { ctx, hnb, plan, e: e!, MMF };
}

const run = (ctx: Ctx, e: SipExecutionDoc, opportunity: Record<string, unknown> | null) =>
  executeSip(ctx, String(e._id), {
    executedOn: TODAY,
    lines: e.lines.map((l) => ({ actualMinor: l.plannedMinor, feeMinor: 0 })),
    opportunity,
  });

const opportunityOf = async (ctx: Ctx, accountId: string) =>
  (await getAccountBuckets(ctx, accountId)).opportunityMinor;

describe("SIP opportunity-fund share", () => {
  it("plans 60,000 · 20,000 · 10,000 + 10,000 opportunity; drift uses investments only", async () => {
    const { ctx, e } = await setup();
    expect(e.lines.map((l) => l.plannedMinor)).toEqual([60_000_00, 20_000_00, 10_000_00]);
    expect(e.opportunityPlannedMinor).toBe(10_000_00);
    expect(e.plannedTotalMinor).toBe(100_000_00);
    const t = await getTarget(ctx);
    expect(t.enteredAllocation.map((c) => c.percentBp)).toEqual([6_000, 2_000, 1_000]);
    expect(t.allocation.map((c) => c.percentBp)).toEqual([6_667, 2_222, 1_111]);
  });

  it("1 · keep it in the source account: reserved, no money moves; undo releases it", async () => {
    const { ctx, hnb, e } = await setup();
    const before = await balanceOf(ctx, hnb.id);
    const { execution } = await run(ctx, e, { actualMinor: 10_000_00, keepIn: "same" });
    expect(execution.status).toBe("done");
    expect(execution.opportunity).toMatchObject({ keepIn: "same", actualMinor: 10_000_00 });
    expect(await balanceOf(ctx, hnb.id)).toBe(before - 90_000_00);
    expect(await opportunityOf(ctx, hnb.id)).toBe(10_000_00);
    await undoSip(ctx, String(e._id));
    expect(await opportunityOf(ctx, hnb.id)).toBe(0);
    expect(await balanceOf(ctx, hnb.id)).toBe(before);
  });

  it("2 · transfer from the source to another account with a bank fee; undo voids it", async () => {
    const { ctx, hnb, e } = await setup();
    const savings = await makeAccount(ctx, { name: "Savings", openingBalanceMinor: 1_00 });
    const before = await balanceOf(ctx, hnb.id);
    await run(ctx, e, {
      actualMinor: 10_000_00,
      feeMinor: 25_00,
      keepIn: "account",
      accountId: savings.id,
    });
    expect(await balanceOf(ctx, hnb.id)).toBe(before - 90_000_00 - 10_000_00 - 25_00);
    expect(await opportunityOf(ctx, savings.id)).toBe(10_000_00);
    const transfer = await TransactionModel.findOne({
      userId: new Types.ObjectId(ctx.userId),
      type: "transfer",
      status: "posted",
    }).lean();
    expect(transfer).toMatchObject({ amountMinor: 10_000_00, feeMinor: 25_00 });
    await undoSip(ctx, String(e._id));
    expect(await balanceOf(ctx, hnb.id)).toBe(before);
    expect(await opportunityOf(ctx, savings.id)).toBe(0);
  });

  it("2 · buy an asset: the asset's opportunity money grows", async () => {
    const { ctx, e, MMF } = await setup();
    await run(ctx, e, { actualMinor: 10_000_00, keepIn: "holding", holdingId: MMF.id });
    expect((await getHoldingBuckets(ctx, MMF.id)).opportunityMinor).toBe(10_000_00);
    await undoSip(ctx, String(e._id));
    expect((await getHoldingBuckets(ctx, MMF.id)).opportunityMinor).toBe(0);
  });

  it("3 · from a different account, kept there: the source only pays the investments", async () => {
    const { ctx, hnb, e } = await setup();
    const commercial = await makeAccount(ctx, {
      name: "Commercial",
      openingBalanceMinor: 50_000_00,
    });
    const before = await balanceOf(ctx, hnb.id);
    await run(ctx, e, { actualMinor: 10_000_00, keepIn: "same", fromAccountId: commercial.id });
    expect(await balanceOf(ctx, hnb.id)).toBe(before - 90_000_00);
    expect(await opportunityOf(ctx, commercial.id)).toBe(10_000_00);
    expect(await opportunityOf(ctx, hnb.id)).toBe(0);
  });

  it("refuses to reserve more than the account's free money (nothing is posted)", async () => {
    const { ctx, e } = await setup();
    const small = await makeAccount(ctx, { name: "Small", openingBalanceMinor: 5_000_00 });
    const err = await run(ctx, e, {
      actualMinor: 10_000_00,
      keepIn: "same",
      fromAccountId: small.id,
    }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toContain("free money");
    expect(
      await TransactionModel.countDocuments({
        userId: new Types.ObjectId(ctx.userId),
        "source.kind": "sip_execution",
      }),
    ).toBe(0);
  });
});
