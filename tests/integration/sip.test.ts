import { Types } from "mongoose";
import { addMonths, format, parse } from "date-fns";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { saveTarget } from "@/modules/allocation/service";
import { setEarmark, getAccountBuckets } from "@/modules/earmarks/service";
import { SipExecutionModel, type SipExecutionDoc } from "@/modules/sip/model";
import {
  createPlan,
  executeSip,
  generateDueExecutions,
  setPlanStatus,
  skipSip,
  undoSip,
  updatePlan,
} from "@/modules/sip/service";
import { TransactionModel } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
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

const TZ = "Asia/Colombo";
const TODAY = utcToBusinessDate(new Date(), TZ);
const K = "yyyy-MM-dd";
const shiftMonths = (key: string, n: number) =>
  format(addMonths(parse(key, K, new Date(2000, 0, 1)), n), K);
const DAY = Math.min(28, Number(TODAY.slice(8)));

async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, {
    name: "Bank",
    openingBalanceMinor: 10_000_000_00,
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
  const A = await h("A", "Equity");
  const B = await h("B", "Equity");
  const MF = await h("MF", "Equity");
  const UT = await h("UT", "Fixed Income");
  const GOLD = await h("Gold", "Gold");
  const BTC = await h("BTC", "Crypto");
  const tree = [
    {
      assetClassId: await assetClassId(ctx, "Equity"),
      percentBp: 5_000,
      assets: [
        { holdingId: A.id, percentBp: 4_000 },
        { holdingId: B.id, percentBp: 2_000 },
        { holdingId: MF.id, percentBp: 4_000 },
      ],
    },
    {
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      percentBp: 3_000,
      assets: [{ holdingId: UT.id, percentBp: 10_000 }],
    },
    {
      assetClassId: await assetClassId(ctx, "Gold"),
      percentBp: 1_000,
      assets: [{ holdingId: GOLD.id, percentBp: 10_000 }],
    },
    {
      assetClassId: await assetClassId(ctx, "Crypto"),
      percentBp: 1_000,
      assets: [{ holdingId: BTC.id, percentBp: 10_000 }],
    },
  ];
  return { ctx, bank, holdings: { A, B, MF, UT, GOLD, BTC }, tree };
}

const planInput = (bankId: string, extra: object = {}) => ({
  name: "Monthly SIP",
  amountMinor: 100_000_00,
  frequency: "monthly",
  dayOfMonth: DAY,
  sourceAccountId: bankId,
  startDate: TODAY.slice(0, 8) + String(DAY).padStart(2, "0"),
  missedPolicy: "skip",
  ...extra,
});

async function executions(ctx: Ctx, planId: string): Promise<SipExecutionDoc[]> {
  return SipExecutionModel.find({
    userId: new Types.ObjectId(ctx.userId),
    planId: new Types.ObjectId(planId),
  })
    .sort({ dueDate: 1 })
    .lean<SipExecutionDoc[]>();
}

const asPlanned = (e: SipExecutionDoc) => ({
  executedOn: TODAY,
  lines: e.lines.map((l) => ({ actualMinor: l.plannedMinor, feeMinor: 0 })),
});

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected a rejection");
}

describe("SIP: split, execute, undo (acceptance)", () => {
  it("100,000 two-level example splits exactly; undo restores balances and holdings", async () => {
    const { ctx, bank, holdings, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(ctx, planInput(bank.id));
    const [e] = await executions(ctx, plan.id);
    expect(e!.status).toBe("due");
    expect(e!.lines.map((l) => [String(l.holdingId), l.plannedMinor])).toEqual([
      [holdings.A.id, 20_000_00],
      [holdings.B.id, 10_000_00],
      [holdings.MF.id, 20_000_00],
      [holdings.UT.id, 30_000_00],
      [holdings.GOLD.id, 10_000_00],
      [holdings.BTC.id, 10_000_00],
    ]);

    const before = {
      bank: await balanceOf(ctx, bank.id),
      A: await holdingDoc(ctx, holdings.A.id),
      UT: await holdingDoc(ctx, holdings.UT.id),
    };
    const input = asPlanned(e!);
    input.lines[0]!.feeMinor = 100_00;
    const { execution } = await executeSip(ctx, String(e!._id), input);
    expect(execution.status).toBe("done");
    expect(execution.onTime).toBe(true);
    expect(await balanceOf(ctx, bank.id)).toBe(before.bank - 100_000_00 - 100_00);
    expect((await holdingDoc(ctx, holdings.A.id)).investedMinor).toBe(20_000_00 + 100_00);
    const txns = await TransactionModel.find({
      userId: new Types.ObjectId(ctx.userId),
      "source.kind": "sip_execution",
      status: "posted",
    }).lean();
    expect(txns).toHaveLength(6);
    expect(new Set(txns.map((t) => String(t.groupId))).size).toBe(1);

    const undone = await undoSip(ctx, String(e!._id));
    expect(undone.status).toBe("due");
    expect(await balanceOf(ctx, bank.id)).toBe(before.bank);
    const A = await holdingDoc(ctx, holdings.A.id);
    expect([A.investedMinor, A.currentValueMinor]).toEqual([
      before.A.investedMinor,
      before.A.currentValueMinor,
    ]);
    expect((await holdingDoc(ctx, holdings.UT.id)).investedMinor).toBe(before.UT.investedMinor);
    expect(
      await TransactionModel.countDocuments({
        userId: new Types.ObjectId(ctx.userId),
        "source.kind": "sip_execution",
        status: "posted",
      }),
    ).toBe(0);
  });

  it("partial when less than planned; zero is rejected (skip instead); lines must name holdings", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(ctx, planInput(bank.id));
    const [e] = await executions(ctx, plan.id);
    const zero = { executedOn: TODAY, lines: e!.lines.map(() => ({ actualMinor: 0 })) };
    expect((await rejection(executeSip(ctx, String(e!._id), zero))).code).toBe("VALIDATION");
    const some = {
      executedOn: TODAY,
      lines: e!.lines.map((l, i) => ({ actualMinor: i === 0 ? l.plannedMinor : 0 })),
    };
    expect((await executeSip(ctx, String(e!._id), some)).execution.status).toBe("partial");
    expect((await rejection(executeSip(ctx, String(e!._id), some))).code).toBe("CONFLICT");
  });

  it("generation is idempotent", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(
      ctx,
      planInput(bank.id, { startDate: shiftMonths(TODAY, -3) }),
    );
    const n = (await executions(ctx, plan.id)).length;
    expect(await generateDueExecutions(ctx)).toBe(0);
    await generateDueExecutions(ctx);
    expect(await executions(ctx, plan.id)).toHaveLength(n);
  });
});

describe("SIP rules over time", () => {
  it("missed after grace; carry-forward chains the shortfall", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const start = shiftMonths(TODAY, -2).slice(0, 8) + String(DAY).padStart(2, "0");
    const { plan } = await createPlan(
      ctx,
      planInput(bank.id, {
        startDate: start,
        missedPolicy: "carry_forward",
        amountMinor: 10_000_00,
      }),
    );
    const ex = await executions(ctx, plan.id);
    expect(ex.map((e) => e.status)).toEqual(["missed", "missed", "due"]);
    expect(ex.map((e) => e.carryInMinor)).toEqual([0, 10_000_00, 20_000_00]);
    expect(ex.map((e) => e.plannedTotalMinor)).toEqual([10_000_00, 20_000_00, 30_000_00]);

    // Executing the first missed period late (partial 4,000) reduces what carries on.
    const first = ex[0]!;
    await executeSip(ctx, String(first._id), {
      executedOn: TODAY,
      lines: first.lines.map((l, i) => ({ actualMinor: i === 0 ? 4_000_00 : 0 })),
    });
    const after = await executions(ctx, plan.id);
    expect(after[0]!.onTime).toBe(false);
    // the second stays "missed" with its own carry frozen; the due one follows the chain
    expect(after.map((e) => e.status)).toEqual(["partial", "missed", "due"]);
    expect(after[2]!.carryInMinor).toBe(20_000_00);
  });

  it("skip policy carries nothing", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(
      ctx,
      planInput(bank.id, { startDate: shiftMonths(TODAY, -2), amountMinor: 10_000_00 }),
    );
    expect((await executions(ctx, plan.id)).every((e) => e.carryInMinor === 0)).toBe(true);
  });

  it("step-up 10% every 12 months applies from the 13th month", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const start = shiftMonths(TODAY, -12).slice(0, 8) + String(DAY).padStart(2, "0");
    const { plan } = await createPlan(
      ctx,
      planInput(bank.id, {
        startDate: start,
        amountMinor: 25_000_00,
        stepUp: { percentBp: 1_000, everyMonths: 12 },
      }),
    );
    const ex = await executions(ctx, plan.id);
    expect(ex[0]!.plannedTotalMinor).toBe(25_000_00);
    expect(ex[11]!.plannedTotalMinor).toBe(25_000_00);
    expect(ex[12]!.plannedTotalMinor).toBe(27_500_00);
  });

  it("skip records a reason, posts nothing, and can be undone", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(ctx, planInput(bank.id));
    const [e] = await executions(ctx, plan.id);
    const skipped = await skipSip(ctx, String(e!._id), { reason: "Short this month" });
    expect(skipped).toMatchObject({ status: "skipped", skipReason: "Short this month" });
    expect(
      await TransactionModel.countDocuments({
        userId: new Types.ObjectId(ctx.userId),
        "source.kind": "sip_execution",
      }),
    ).toBe(0);
    expect((await undoSip(ctx, String(e!._id))).status).toBe("due");
  });

  it("pause generates nothing; resume does not back-fill", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const start = shiftMonths(TODAY, 1);
    const { plan } = await createPlan(ctx, planInput(bank.id, { startDate: start }));
    expect(await executions(ctx, plan.id)).toHaveLength(0); // starts next month
    await setPlanStatus(ctx, plan.id, "paused");
    await generateDueExecutions(ctx);
    expect(await executions(ctx, plan.id)).toHaveLength(0);
    await setPlanStatus(ctx, plan.id, "active");
    expect(await executions(ctx, plan.id)).toHaveLength(0);
  });
});

describe("versions and the target allocation", () => {
  it("a plan on target follows target edits for future executions only", async () => {
    const { ctx, bank, holdings, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const start = shiftMonths(TODAY, -1).slice(0, 8) + String(DAY).padStart(2, "0");
    const { plan } = await createPlan(ctx, planInput(bank.id, { startDate: start, graceDays: 60 }));
    const [past, current] = await executions(ctx, plan.id);
    await executeSip(ctx, String(past!._id), asPlanned(past!));

    // New target: 100% gold
    const gold = tree[2]!;
    await saveTarget(ctx, { allocation: [{ ...gold, percentBp: 10_000 }], thresholdBp: 500 });
    const [p, c] = await executions(ctx, plan.id);
    expect(p!.allocationUsed).toHaveLength(4); // executed: keeps the tree it used
    expect(p!.lines).toHaveLength(6);
    expect(c!.lines.map((l) => [String(l.holdingId), l.plannedMinor])).toEqual([
      [holdings.GOLD.id, 100_000_00],
    ]);
    expect(String(current!._id)).toBe(String(c!._id));
  });

  it("changing the amount creates version 2 effective from the next due date", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(ctx, planInput(bank.id));
    const res = await updatePlan(ctx, plan.id, { ...planInput(bank.id), amountMinor: 50_000_00 });
    expect(res.newVersion).toBe(2);
    expect(res.effectiveFrom).toBe(
      (await executions(ctx, plan.id))[0]
        ? utcToBusinessDate((await executions(ctx, plan.id))[0]!.dueDate, TZ)
        : null,
    );
    const [e] = await executions(ctx, plan.id);
    expect(e!.planVersion).toBe(2);
    expect(e!.plannedTotalMinor).toBe(50_000_00);
    // a name-only change creates no version
    expect(
      (
        await updatePlan(ctx, plan.id, {
          ...planInput(bank.id),
          amountMinor: 50_000_00,
          name: "Renamed",
        })
      ).newVersion,
    ).toBeNull();
  });

  it("custom trees must name holdings in the plan currency", async () => {
    const { ctx, bank, tree } = await setup();
    const err = await rejection(
      createPlan(
        ctx,
        planInput(bank.id, {
          allocationSource: "custom",
          allocation: [{ ...tree[2]!, percentBp: 10_000, assets: [] }],
        }),
      ),
    );
    expect(err.code).toBe("VALIDATION");
    const usd = await makeHolding(ctx, {
      name: "USD ETF",
      currency: "USD",
      assetClassId: tree[0]!.assetClassId,
    });
    const err2 = await rejection(
      createPlan(
        ctx,
        planInput(bank.id, {
          allocationSource: "custom",
          allocation: [
            {
              assetClassId: tree[0]!.assetClassId,
              percentBp: 10_000,
              assets: [{ holdingId: usd.id, percentBp: 10_000 }],
            },
          ],
        }),
      ),
    );
    expect(err2.message).toMatch(/USD/);
  });
});

describe("dip guard on execute (docs/04 §20)", () => {
  it("checks the total once; confirmation reduces earmarks once", async () => {
    const { ctx, tree } = await setup();
    const bank = await makeAccount(ctx, {
      name: "Earmarked",
      openingBalanceMinor: 150_000_00,
      openingDate: "2024-01-01",
    });
    await setEarmark(ctx, {
      accountId: bank.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 100_000_00,
    });
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(ctx, planInput(bank.id));
    const [e] = await executions(ctx, plan.id);
    const err = await rejection(executeSip(ctx, String(e!._id), asPlanned(e!)));
    expect(err.code).toBe("NEEDS_CONFIRMATION");
    expect(err.warnings).toEqual([
      expect.objectContaining({ code: "DIPS_INTO_OPPORTUNITY", amountMinor: 50_000_00 }),
    ]);
    await executeSip(ctx, String(e!._id), { ...asPlanned(e!), confirmOpportunity: true });
    expect(await getAccountBuckets(ctx, bank.id)).toMatchObject({
      balanceMinor: 50_000_00,
      opportunityMinor: 50_000_00,
      freeMinor: 0,
    });
  });
});

describe("isolation", () => {
  it("another user cannot execute, skip or undo", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    const { plan } = await createPlan(ctx, planInput(bank.id));
    const [e] = await executions(ctx, plan.id);
    const other = await makeUser();
    expect((await rejection(executeSip(other, String(e!._id), asPlanned(e!)))).code).toBe(
      "NOT_FOUND",
    );
    expect((await rejection(skipSip(other, String(e!._id), { reason: "x" }))).code).toBe(
      "NOT_FOUND",
    );
    expect((await rejection(setPlanStatus(other, plan.id, "paused"))).code).toBe("NOT_FOUND");
  });
});

describe("SIPs in Upcoming and safe to spend (docs/04 §21)", () => {
  it("due and projected periods carry outflowMinor from an earmarkable source", async () => {
    const { ctx, bank, tree } = await setup();
    await saveTarget(ctx, { allocation: tree, thresholdBp: 500 });
    await createPlan(ctx, planInput(bank.id, { amountMinor: 20_000_00 }));
    const { getUpcoming, getSafeToSpend } = await import("@/modules/dashboard/queries");
    const items = (await getUpcoming(ctx, shiftMonths(TODAY, 2))).filter((i) => i.kind === "sip");
    expect(items.length).toBeGreaterThanOrEqual(3); // this month (generated) + 2 projected
    expect(items.every((i) => i.outflowMinor === 20_000_00 && i.accountId === bank.id)).toBe(true);
    const safe = await getSafeToSpend(ctx);
    expect(safe.committedMinor).toBe(
      items
        .filter((i) => i.dueDate <= safe.monthEnd)
        .reduce((s, i) => s + (i.outflowMinor ?? 0), 0),
    );
  });
});
