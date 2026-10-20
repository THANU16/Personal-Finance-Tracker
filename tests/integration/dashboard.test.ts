import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";
import { cashflowOf } from "@/domain/ledger";
import { parseRangeView } from "@/domain/date-range";
import { computeNetWorthAsOf } from "@/domain/series";
import { utcToBusinessDate } from "@/domain/dates";
import { getAccountsOverview } from "@/modules/accounts/queries";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import {
  allocationAsOf,
  cashflowSeries,
  getSafeToSpend,
  getStanding,
  getUpcoming,
  netWorthSeries,
  topExpenseCategories,
} from "@/modules/dashboard/queries";
import { setEarmark } from "@/modules/earmarks/service";
import { saveFxRate } from "@/modules/fx/service";
import { createHolding } from "@/modules/holdings/service";
import { SnapshotModel } from "@/modules/snapshots/model";
import {
  ensureMonthEndSnapshot,
  listMonthEndSnapshots,
  rebuildHistory,
} from "@/modules/snapshots/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { toLedgerTxn } from "@/server/ledger/to-ledger-txn";
import {
  assetClassId,
  categoryId,
  makeAccount,
  makeHolding,
  makeUser,
  post,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const TODAY = utcToBusinessDate(new Date(), "Asia/Colombo");
const view = (params: Record<string, string>) => parseRangeView(params, TODAY);

let ctx: Ctx;
let bank: { id: string };
let card: { id: string };
let usd: { id: string };

/** Fixed scenario: Jan–Mar 2026, LKR base, one USD wallet, a market holding and an FD. */
async function scenario() {
  ctx = await makeUser();
  bank = await makeAccount(ctx, { name: "Commercial Bank", openingBalanceMinor: 500_000 });
  card = await makeAccount(ctx, {
    name: "Visa",
    type: "credit_card",
    creditCard: { limitMinor: 1_000_000, statementDay: 20, dueDay: 5 },
  });
  usd = await makeAccount(ctx, { name: "USD wallet", type: "wallet", currency: "USD" });
  const salary = await categoryId(ctx, "Salary");
  const groceries = await categoryId(ctx, "Groceries");
  const restaurants = await categoryId(ctx, "Restaurants");
  const rent = await categoryId(ctx, "Rent");
  const fuel = await categoryId(ctx, "Fuel");
  for (const month of ["01", "02", "03"]) {
    await post(ctx, {
      type: "income",
      date: `2026-${month}-25`,
      amountMinor: 300_000,
      toAccountId: bank.id,
      categoryId: salary,
    });
    await post(ctx, {
      type: "expense",
      date: `2026-${month}-03`,
      amountMinor: 80_000,
      fromAccountId: bank.id,
      categoryId: rent,
    });
  }
  await post(ctx, {
    type: "expense",
    date: "2026-01-31", // month boundary
    amountMinor: 12_000,
    fromAccountId: card.id,
    splits: [
      { categoryId: groceries, amountMinor: 9_000 },
      { categoryId: restaurants, amountMinor: 3_000 },
    ],
  });
  await post(ctx, {
    type: "expense",
    date: "2026-02-10",
    amountMinor: 6_000,
    fromAccountId: bank.id,
    categoryId: fuel,
  });
  await post(ctx, {
    type: "transfer",
    date: "2026-02-15",
    amountMinor: 12_000,
    feeMinor: 50,
    fromAccountId: bank.id,
    toAccountId: card.id,
  });
  await post(ctx, {
    type: "income",
    date: "2026-03-05",
    amountMinor: 10_000, // $100.00
    toAccountId: usd.id,
    categoryId: salary,
  });
  await post(ctx, {
    type: "expense",
    date: "2026-03-06",
    amountMinor: 2_000, // $20.00
    fromAccountId: usd.id,
    categoryId: groceries,
  });
  const fund = await makeHolding(ctx, {
    name: "Equity fund",
    liquidity: "high",
    openingDate: "2026-01-01",
    investedMinor: 200_000,
    currentValueMinor: 200_000,
  });
  await post(ctx, {
    type: "invest",
    date: "2026-02-20",
    amountMinor: 50_000,
    feeMinor: 500,
    fromAccountId: bank.id,
    holdingId: fund.id,
  });
  await createHolding(ctx, {
    name: "NSB FD",
    assetClassId: await assetClassId(ctx, "Fixed Income"),
    instrumentType: "fd",
    currency: "LKR",
    fd: {
      principalMinor: 1_000_000,
      rateBp: 1_000,
      startDate: "2026-01-01",
      maturityDate: "2026-12-31",
      compounding: "monthly",
      payout: "at_maturity",
    },
  });
  return { fund };
}

async function ledgerIn(from: string, to: string): Promise<TransactionDoc[]> {
  const all = await TransactionModel.find({
    userId: new Types.ObjectId(ctx.userId),
    status: "posted",
  }).lean<TransactionDoc[]>();
  return all.filter((t) => {
    const d = utcToBusinessDate(t.date, ctx.tz);
    return d >= from && d <= to && t.currency === "LKR";
  });
}

describe("dashboard queries on the fixed scenario", () => {
  beforeEach(async () => {
    await scenario();
  });

  it("net worth series: every bucket equals computeNetWorthAsOf; today equals balances + holdings", async () => {
    const v = view({ from: "2026-01-01", to: "2026-03-31", g: "week" });
    const series = await netWorthSeries(ctx, v);
    expect(series.points).toHaveLength(14); // gap-free Monday weeks
    const input = await loadSeriesInput(ctx);
    for (const p of series.points) {
      expect(p.netWorthMinor).toBe(computeNetWorthAsOf(input, p.end).netWorthMinor);
    }
    // the USD wallet has no rate yet: excluded and counted, never 1:1
    expect(series.fxMissing).toBe(1);

    await saveFxRate(ctx, { date: "2026-01-01", base: "USD", quote: "LKR", rate: 300 });
    const now = await netWorthSeries(ctx, view({ r: "today" }));
    const accounts = (await getAccountsOverview(ctx)).groups.flatMap((g) => g.accounts);
    const balances = accounts.reduce(
      (s, a) => s + (a.currency === "USD" ? a.balanceMinor * 300 : a.balanceMinor),
      0,
    );
    const allocation = await allocationAsOf(ctx, TODAY);
    expect(now.points.at(-1)!.netWorthMinor).toBe(balances + allocation.totalMinor);
    expect(now.fxMissing).toBe(0);
  });

  it("cashflow: flows summed per month equal cashflowOf over the same ledger", async () => {
    const v = view({ from: "2026-01-01", to: "2026-03-31", g: "month" });
    const cf = await cashflowSeries(ctx, v);
    expect(cf.points.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    for (const p of cf.points) {
      const ref = cashflowOf((await ledgerIn(p.start, p.end)).map(toLedgerTxn));
      expect(p.incomeMinor).toBe(ref.incomeMinor + ref.investmentIncomeMinor);
      expect(p.expenseMinor).toBe(ref.expenseMinor);
    }
    // the card spend dated 31 Jan lands in January; the transfer fee is an expense in February
    expect(cf.points[0]!.expenseMinor).toBe(80_000 + 12_000);
    expect(cf.points[1]!.expenseMinor).toBe(80_000 + 6_000 + 50);
    expect(cf.points[1]!.investMinor).toBe(50_000); // excluding the fee
    expect(cf.fxMissing).toBe(2); // USD income + expense, no rate
    expect(cf.totals.savingsRateBp).toBe(Math.round(((900_000 - 258_050) * 10_000) / 900_000));
  });

  it("compare: previous period aligned bucket by bucket with totals and % change", async () => {
    // March (31 days) vs 29 Jan – 28 Feb (31 days), weekly buckets starting Monday
    const cf = await cashflowSeries(
      ctx,
      view({ from: "2026-03-01", to: "2026-03-31", g: "week", cmp: "1" }),
    );
    expect(cf.points.map((p) => [p.start, p.end])).toEqual([
      ["2026-03-01", "2026-03-01"],
      ["2026-03-02", "2026-03-08"],
      ["2026-03-09", "2026-03-15"],
      ["2026-03-16", "2026-03-22"],
      ["2026-03-23", "2026-03-29"],
      ["2026-03-30", "2026-03-31"],
    ]);
    // previous buckets: 29 Jan–1 Feb (card spend 12,000), 2–8 Feb (rent), …, 23–28 Feb (salary)
    expect(cf.points[0]!.previous).toMatchObject({ expenseMinor: 12_000 });
    expect(cf.points[1]!.previous).toMatchObject({ expenseMinor: 80_000 });
    expect(cf.points[5]!.previous).toBeNull(); // the previous period has one bucket fewer
    expect(cf.previousTotals).toMatchObject({ incomeMinor: 300_000, expenseMinor: 98_050 });
    expect(cf.expenseChange).toEqual({
      currentMinor: 80_000,
      previousMinor: 98_050,
      deltaMinor: -18_050,
      pctBp: -1_841,
    });
    const nw = await netWorthSeries(
      ctx,
      view({ from: "2026-03-01", to: "2026-03-31", g: "week", cmp: "1" }),
    );
    expect(nw.points[0]!.previousNetWorthMinor).not.toBeNull();
    expect(nw.change.previousMinor).toBe(
      computeNetWorthAsOf(await loadSeriesInput(ctx), "2026-02-28").netWorthMinor,
    );
  });

  it("top categories roll children up to their parent, splits per line, fees under Bank fees", async () => {
    const top = await topExpenseCategories(ctx, { from: "2026-01-01", to: "2026-03-31" });
    expect(top.categories.map((c) => [c.name, c.valueMinor])).toEqual([
      ["Housing", 240_000],
      ["Food & Dining", 12_000],
      ["Transport", 6_000],
      ["Bank fees", 50],
    ]);
    expect(top.totalMinor).toBe(258_050);
    expect(top.fxMissing).toBe(1);
  });

  it("allocation: class → holdings drill-down as of the end date; FD via §9", async () => {
    const a = await allocationAsOf(ctx, "2026-03-31");
    expect(a.classes.map((c) => c.name)).toEqual(["Equity", "Fixed Income"]);
    expect(a.classes[0]!.holdings).toEqual([
      expect.objectContaining({ name: "Equity fund", valueMinor: 250_000, shareBp: 10_000 }),
    ]);
    expect(a.classes[1]!.valueMinor).toBeGreaterThan(1_000_000); // interest accrued since 1 Jan
    expect(a.classes.reduce((s, c) => s + c.shareBp, 0)).toBeGreaterThanOrEqual(9_999);
  });

  it("standing: savings and investment rates for the range; runway from cash + high-liquidity", async () => {
    const s = await getStanding(ctx, view({ from: "2026-01-01", to: "2026-03-31" }));
    expect(s.savingsRateBp).toBe(Math.round(((900_000 - 258_050) * 10_000) / 900_000));
    expect(s.investmentRateBp).toBe(Math.round((50_000 * 10_000) / 900_000));
    expect(s.debtLoadBp).toBeNull();
    // Phase 10: wired to Essentials (scenario data is months old, so only part of the score is earned).
    expect(s.healthScore).toEqual({ score: expect.any(Number), reasons: expect.any(Array) });
    expect(s.healthScore!.score).toBeGreaterThanOrEqual(0);
    expect(s.healthScore!.score).toBeLessThanOrEqual(100);
    expect(s.netWorthChange.currentMinor).toBe(s.netWorthMinor);
  });

  it("upcoming: FD maturity (no outflow); a paid-off card is not due", async () => {
    const items = await getUpcoming(ctx, "2099-12-31");
    expect(items.map((i) => [i.kind, i.dueDate, i.outflowMinor ?? null])).toEqual([
      ["fd_maturity", "2026-12-31", null],
    ]);
    expect(await getUpcoming(ctx, "2026-12-30")).toEqual([]);
  });
});

describe("safe to spend and the cash bar (docs/04 §20, §21)", () => {
  it("earmark example: free 50,000; a card due this month is subtracted", async () => {
    ctx = await makeUser();
    const account = await makeAccount(ctx, {
      name: "Commercial Bank",
      openingBalanceMinor: 350_000,
    });
    await setEarmark(ctx, {
      accountId: account.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 100_000,
    });
    await setEarmark(ctx, {
      accountId: account.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 200_000,
    });
    let s = await getSafeToSpend(ctx);
    expect(s).toMatchObject({
      freeCashMinor: 50_000,
      emergencyMinor: 100_000,
      opportunityMinor: 200_000,
      committedMinor: 0,
      safeMinor: 50_000,
    });
    const visa = await makeAccount(ctx, {
      name: "Visa",
      type: "credit_card",
      creditCard: { limitMinor: 500_000, statementDay: 1, dueDay: Number(s.monthEnd.slice(8)) },
    });
    await post(ctx, {
      type: "expense",
      date: TODAY,
      amountMinor: 70_000,
      fromAccountId: visa.id,
      categoryId: await categoryId(ctx, "Groceries"),
    });
    s = await getSafeToSpend(ctx);
    expect(s.committedMinor).toBe(70_000);
    expect(s.safeMinor).toBe(-20_000); // negative → the UI shows a warning
  });
});

describe("snapshots (docs/04 §16)", () => {
  it("rebuild history writes completed month-ends equal to the live series; idempotent", async () => {
    await scenario();
    const first = await rebuildHistory(ctx);
    const again = await rebuildHistory(ctx);
    expect(again.months).toBe(first.months);
    const uid = new Types.ObjectId(ctx.userId);
    expect(await SnapshotModel.countDocuments({ userId: uid, kind: "auto" })).toBe(first.months);
    const snaps = await listMonthEndSnapshots(ctx, "2026-01-01", "2026-03-31");
    expect(snaps.map((s) => s.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    const input = await loadSeriesInput(ctx);
    for (const s of snaps) {
      expect(s.netWorthMinor).toBe(computeNetWorthAsOf(input, s.date).netWorthMinor);
    }
    // a month view over > 1 year reads the cache
    const long = await netWorthSeries(
      ctx,
      view({ from: "2025-01-01", to: "2026-03-31", g: "month" }),
    );
    expect(long.source).toBe("snapshots");
    expect(long.points.find((p) => p.key === "2026-02")!.netWorthMinor).toBe(
      snaps[1]!.netWorthMinor,
    );
  });

  it("the month-end job is idempotent", async () => {
    await scenario();
    expect(await ensureMonthEndSnapshot(ctx, "2026-03-01")).toBe(true);
    expect(await ensureMonthEndSnapshot(ctx, "2026-03-15")).toBe(false);
    const uid = new Types.ObjectId(ctx.userId);
    expect(await SnapshotModel.countDocuments({ userId: uid })).toBe(1);
  });
});

describe("isolation", () => {
  it("another user sees nothing", async () => {
    await scenario();
    const other = await makeUser();
    const s = await netWorthSeries(
      other,
      view({ from: "2026-01-01", to: "2026-03-31", g: "month" }),
    );
    expect(s.points.every((p) => p.netWorthMinor === 0)).toBe(true);
    expect(
      (await cashflowSeries(other, view({ from: "2026-01-01", to: "2026-03-31" }))).totals
        .incomeMinor,
    ).toBe(0);
    expect(
      (await topExpenseCategories(other, { from: "2026-01-01", to: "2026-03-31" })).categories,
    ).toEqual([]);
  });
});
