import { describe, expect, it } from "vitest";
import { computeInsights, type InsightsInput } from "@/domain/insights";

const quiet: InsightsInput = {
  dayOfMonth: 25,
  categories: [],
  feesQuarterMinor: 0,
  investedQuarterMinor: 0,
  staleCount: 0,
  fdMaturing30: [],
  budgets: [],
  freeCashMinor: 0,
  avgMonthlyExpenseMinor: 100_000,
  emergencyFull: false,
  offTargetCount: 0,
  missedSipCount: 0,
  savingsRateBp: 2_000,
  previousSavingsRateBp: 2_500,
};

describe("computeInsights (docs/04 §22)", () => {
  it("nothing to say → empty", () => {
    expect(computeInsights(quiet)).toEqual([]);
  });

  it("each rule fires at its threshold", () => {
    const keys = (i: Partial<InsightsInput>) =>
      computeInsights({ ...quiet, ...i }, 10).map((x) => x.key);
    expect(
      keys({
        dayOfMonth: 19,
        budgets: [{ categoryId: "c", name: "Food", spentMinor: 80, limitMinor: 100 }],
      }),
    ).toEqual(["budget_early"]);
    expect(
      keys({
        dayOfMonth: 20,
        budgets: [{ categoryId: "c", name: "Food", spentMinor: 80, limitMinor: 100 }],
      }),
    ).toEqual([]);
    expect(keys({ savingsRateBp: 1_500, previousSavingsRateBp: 2_500 })).toEqual(["savings_down"]);
    expect(
      keys({
        categories: [{ categoryId: "c", name: "Food", thisMonthMinor: 131, avg3Minor: 100 }],
      }),
    ).toEqual(["category_spike"]);
    expect(
      keys({
        categories: [{ categoryId: "c", name: "Food", thisMonthMinor: 130, avg3Minor: 100 }],
      }),
    ).toEqual([]);
    expect(keys({ feesQuarterMinor: 101, investedQuarterMinor: 10_000 })).toEqual(["fees_high"]);
    expect(keys({ feesQuarterMinor: 100, investedQuarterMinor: 10_000 })).toEqual([]);
    expect(keys({ freeCashMinor: 300_001, emergencyFull: true })).toEqual(["idle_cash"]);
    expect(keys({ freeCashMinor: 300_001, emergencyFull: false })).toEqual([]);
    expect(keys({ offTargetCount: 1, missedSipCount: 2 })).toEqual(["missed_sip", "drift"]);
    expect(
      keys({
        staleCount: 1,
        fdMaturing30: [{ holdingId: "h", name: "FD", maturityDate: "2026-11-01" }],
      }),
    ).toEqual(["fd_maturing", "stale_values"]);
  });

  it("ranks and caps at 5", () => {
    const all = computeInsights({
      ...quiet,
      dayOfMonth: 5,
      budgets: [{ categoryId: "c", name: "Food", spentMinor: 90, limitMinor: 100 }],
      savingsRateBp: 0,
      missedSipCount: 1,
      offTargetCount: 1,
      emergencyFull: true,
      freeCashMinor: 1_000_000,
      staleCount: 3,
    });
    expect(all.map((i) => i.key)).toEqual([
      "budget_early",
      "savings_down",
      "missed_sip",
      "drift",
      "idle_cash",
    ]);
  });
});
