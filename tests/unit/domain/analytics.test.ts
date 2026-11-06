import { describe, expect, it } from "vitest";
import {
  alignPrevious,
  bucketFlows,
  changeOf,
  costBreakdown,
  flowTotals,
  netWorthBridge,
  ratioBp,
  runwayTenths,
  safeToSpend,
  spendingPace,
  type DailyFlow,
} from "@/domain/analytics";
import { buildBuckets } from "@/domain/date-range";

const day = (d: string, f: Partial<DailyFlow>): DailyFlow => ({
  day: d,
  incomeMinor: 0,
  investmentIncomeMinor: 0,
  expenseMinor: 0,
  investMinor: 0,
  ...f,
});

describe("bucketFlows", () => {
  const buckets = buildBuckets({ from: "2026-01-01", to: "2026-03-31" }, "month");
  const points = bucketFlows(
    [
      day("2026-01-25", { incomeMinor: 200_000 }),
      day("2026-01-03", { expenseMinor: 50_000 }),
      day("2026-01-31", { expenseMinor: 30_000, investMinor: 40_000 }),
      day("2026-03-10", { expenseMinor: 10_000, investmentIncomeMinor: 5_000 }),
      day("2025-12-31", { incomeMinor: 999 }), // outside the range
      day("2026-04-01", { incomeMinor: 999 }),
    ],
    buckets,
  );

  it("sums flows per bucket and returns every bucket (gap fill)", () => {
    expect(points.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(points[0]).toMatchObject({
      incomeMinor: 200_000,
      expenseMinor: 80_000,
      savingsMinor: 120_000,
      savingsRateBp: 6_000,
      investMinor: 40_000,
    });
    expect(points[1]).toMatchObject({ incomeMinor: 0, expenseMinor: 0, savingsRateBp: null });
  });

  it("investment income paid out counts as income", () => {
    expect(points[2]).toMatchObject({
      incomeMinor: 5_000,
      investmentIncomeMinor: 5_000,
      savingsMinor: -5_000,
      savingsRateBp: -10_000,
    });
  });

  it("totals: savings rate and investment rate over the range", () => {
    expect(flowTotals(points)).toEqual({
      incomeMinor: 205_000,
      expenseMinor: 90_000,
      savingsMinor: 115_000,
      savingsRateBp: 5_610,
      investMinor: 40_000,
      investmentRateBp: 1_951,
    });
  });

  it("weekly buckets put Sunday in the week starting Monday", () => {
    const weeks = buildBuckets({ from: "2026-10-05", to: "2026-10-18" }, "week");
    const p = bucketFlows(
      [day("2026-10-11", { expenseMinor: 7 }), day("2026-10-12", { expenseMinor: 3 })],
      weeks,
    );
    expect(p.map((x) => x.expenseMinor)).toEqual([7, 3]);
  });
});

describe("compare helpers", () => {
  it("changeOf: delta and % vs |previous|; null % when previous is 0", () => {
    expect(changeOf(120, 100)).toEqual({
      currentMinor: 120,
      previousMinor: 100,
      deltaMinor: 20,
      pctBp: 2_000,
    });
    expect(changeOf(-50, -100).pctBp).toBe(5_000);
    expect(changeOf(10, 0).pctBp).toBeNull();
  });

  it("alignPrevious pads missing buckets with null", () => {
    expect(alignPrevious([1, 2, 3], ["a", "b"])).toEqual(["a", "b", null]);
  });
});

describe("ratios", () => {
  it("ratioBp is null without a positive denominator", () => {
    expect(ratioBp(1, 0)).toBeNull();
    expect(ratioBp(1, 3)).toBe(3_333);
  });

  it("runway in tenths of a month", () => {
    expect(runwayTenths(450_000, 100_000)).toBe(45);
    expect(runwayTenths(-5, 100)).toBe(0);
    expect(runwayTenths(1, 0)).toBeNull();
  });
});

describe("safeToSpend (docs/04 §21)", () => {
  it("free cash minus unposted outflows due by month end; may be negative", () => {
    const items = [
      { dueDate: "2026-10-20", outflowMinor: 30_000 },
      { dueDate: "2026-10-31", outflowMinor: 25_000 },
      { dueDate: "2026-11-01", outflowMinor: 99_999 }, // next month
      { dueDate: "2026-10-25", outflowMinor: 10_000, posted: true },
      { dueDate: "2026-10-26" }, // FD maturity: no outflow
    ];
    expect(safeToSpend(50_000, items, "2026-10-31")).toEqual({
      safeMinor: -5_000,
      committedMinor: 55_000,
    });
  });
});

describe("netWorthBridge (docs/04 §25.1)", () => {
  it("saved + market gain + other = the change", () => {
    const b = netWorthBridge({
      startMinor: 213_700_000,
      endMinor: 221_033_026,
      savedMinor: -1_564_040,
      marketGainMinor: 8_667_332,
    });
    expect(b.changeMinor).toBe(7_333_026);
    expect(b.otherMinor).toBe(7_333_026 + 1_564_040 - 8_667_332);
    expect(b.savedMinor + b.marketGainMinor + b.otherMinor).toBe(b.changeMinor);
  });
});

describe("spendingPace (docs/04 §25.3)", () => {
  it("day 7 of 30, usual 156,000, spent 48,000 → ahead by 11,600", () => {
    expect(
      spendingPace({ spentMinor: 4_800_000, usualMonthMinor: 15_600_000, day: 7, daysInMonth: 30 }),
    ).toEqual({
      expectedMinor: 3_640_000,
      overMinor: 1_160_000,
      spentBp: 3077,
      expectedBp: 2333,
      status: "ahead",
    });
  });
  it("within 2.5% of a usual month is on pace; far under is below", () => {
    const base = { usualMonthMinor: 10_000_000, day: 15, daysInMonth: 30 };
    expect(spendingPace({ ...base, spentMinor: 5_200_000 }).status).toBe("on_pace");
    expect(spendingPace({ ...base, spentMinor: 4_000_000 }).status).toBe("below");
  });
  it("no history: no comparison", () => {
    expect(
      spendingPace({ spentMinor: 100, usualMonthMinor: 0, day: 3, daysInMonth: 31 }),
    ).toMatchObject({ status: "no_history", spentBp: null });
  });
});

describe("costBreakdown (docs/04 §25.4)", () => {
  const row = (type: string, f: Partial<Parameters<typeof costBreakdown>[0][number]> = {}) => ({
    type,
    amountMinor: 0,
    feeMinor: 0,
    interestMinor: 0,
    costCategory: null,
    ...f,
  });
  it("groups interest, bank, investment and transfer fees, largest first", () => {
    expect(
      costBreakdown([
        row("debt_payment", { amountMinor: 5_000_000, interestMinor: 4_820_000 }),
        row("expense", { amountMinor: 33_579, costCategory: "bank_fees" }),
        row("expense", { amountMinor: 57_107, costCategory: "bank_fees" }),
        row("invest", { amountMinor: 2_500_000, feeMinor: 2_500 }),
        row("redeem", { amountMinor: 1_000_000, feeMinor: 1_000 }),
        row("transfer", { amountMinor: 900_000, feeMinor: 5_000 }),
        row("expense", { amountMinor: 999_999 }), // groceries: not a cost
      ]),
    ).toEqual({
      totalMinor: 4_820_000 + 90_686 + 3_500 + 5_000,
      items: [
        { kind: "loan_interest", amountMinor: 4_820_000 },
        { kind: "bank_fees", amountMinor: 90_686 },
        { kind: "transfer_fees", amountMinor: 5_000 },
        { kind: "investment_fees", amountMinor: 3_500 },
      ],
    });
  });
});
