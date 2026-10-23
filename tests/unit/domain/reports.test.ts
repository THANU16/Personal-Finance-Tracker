import { describe, expect, it } from "vitest";
import {
  buildMonthlyReview,
  categoryBreakdown,
  incomeByHolding,
  realisedTotals,
} from "@/domain/reports";

const cats = [
  { id: "food", name: "Food", parentId: null },
  { id: "groc", name: "Groceries", parentId: "food" },
  { id: "rent", name: "Rent", parentId: null },
];

describe("categoryBreakdown", () => {
  it("rolls children up, compares with the previous period, sorts by amount", () => {
    const rows = categoryBreakdown(
      [
        { categoryId: "groc", amountMinor: 300 },
        { categoryId: "food", amountMinor: 100 },
        { categoryId: "rent", amountMinor: 600 },
      ],
      cats,
      [{ categoryId: "groc", amountMinor: 200 }],
    );
    expect(
      rows.map((r) => [r.categoryId, r.amountMinor, r.previousMinor, r.changeBp, r.shareBp]),
    ).toEqual([
      ["rent", 600, 0, null, 6_000],
      ["food", 400, 200, 10_000, 4_000],
    ]);
    expect(rows[1]!.children).toEqual([
      { categoryId: "groc", name: "Groceries", amountMinor: 300 },
    ]);
  });
});

describe("realised and income", () => {
  it("totals redemptions and groups income per holding", () => {
    const base = { date: "d", holdingId: "h", holdingName: "H", taxMinor: 0 };
    expect(
      realisedTotals([
        {
          ...base,
          id: "1",
          amountMinor: 400,
          feeMinor: 10,
          costRemovedMinor: 260,
          realizedGainMinor: 130,
        },
        {
          ...base,
          id: "2",
          amountMinor: 100,
          feeMinor: 0,
          costRemovedMinor: 120,
          realizedGainMinor: -20,
        },
      ]),
    ).toEqual({
      amountMinor: 500,
      feeMinor: 10,
      taxMinor: 0,
      costRemovedMinor: 380,
      realizedGainMinor: 110,
    });
    const rows = incomeByHolding([
      {
        holdingId: "a",
        holdingName: "A",
        incomeKind: "dividend",
        grossMinor: 100,
        taxMinor: 10,
        reinvested: false,
      },
      {
        holdingId: "a",
        holdingName: "A",
        incomeKind: "interest",
        grossMinor: 50,
        taxMinor: 5,
        reinvested: true,
      },
      {
        holdingId: "b",
        holdingName: "B",
        incomeKind: "interest",
        grossMinor: 500,
        taxMinor: 0,
        reinvested: false,
      },
    ]);
    expect(rows.map((r) => r.holdingId)).toEqual(["b", "a"]);
    expect(rows[1]).toMatchObject({
      grossMinor: 150,
      taxMinor: 15,
      netMinor: 135,
      reinvestedMinor: 45,
      byKind: { dividend: 100, interest: 50 },
    });
  });
});

describe("buildMonthlyReview", () => {
  it("rates, changes, every income / expense category and 3 insights", () => {
    const r = buildMonthlyReview({
      month: "2026-09",
      currency: "LKR",
      flows: { incomeMinor: 1_000, expenseMinor: 600 },
      previousFlows: { incomeMinor: 800, expenseMinor: 800 },
      categories: categoryBreakdown(
        Array.from({ length: 7 }, (_, i) => ({ categoryId: `c${i}`, amountMinor: 100 + i })),
        cats,
      ),
      incomeCategories: categoryBreakdown([{ categoryId: "salary", amountMinor: 1_000 }], cats),
      budgets: [],
      netWorthStartMinor: 10_000,
      netWorthEndMinor: 10_500,
      sips: { done: 1, partial: 0, missed: 1, skipped: 0, investedMinor: 300 },
      realizedGainMinor: 0,
      feesMinor: 5,
      insights: [1, 2, 3, 4].map((i) => ({
        key: "drift" as const,
        severity: "info" as const,
        title: `${i}`,
        body: "",
        href: "/",
      })),
    });
    expect(r).toMatchObject({
      savingsMinor: 400,
      savingsRateBp: 4_000,
      previous: { savingsRateBp: 0 },
      incomeChangeBp: 2_500,
      expenseChangeBp: -2_500,
      netWorth: { changeMinor: 500, changeBp: 500 },
    });
    expect(r.insights).toHaveLength(3);
    // Owner request: all categories, not only the top 5; largest first, with shares.
    expect(r.expenseCategories).toHaveLength(7);
    expect(r.expenseCategories[0]).toMatchObject({ categoryId: "c6", amountMinor: 106 });
    expect(r.expenseCategories.reduce((s, c) => s + c.amountMinor, 0)).toBe(721);
    expect(r.incomeCategories).toEqual([
      expect.objectContaining({ categoryId: "salary", amountMinor: 1_000, shareBp: 10_000 }),
    ]);
  });
});
