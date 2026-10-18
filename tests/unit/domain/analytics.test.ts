import { describe, expect, it } from "vitest";
import {
  alignPrevious,
  bucketFlows,
  changeOf,
  flowTotals,
  ratioBp,
  runwayTenths,
  safeToSpend,
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
