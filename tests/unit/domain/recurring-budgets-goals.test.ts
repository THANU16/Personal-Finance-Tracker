import { describe, expect, it } from "vitest";
import {
  budgetActuals,
  budgetStatus,
  budgetTotal,
  budgetedSpendTotal,
  copyForward,
  previousMonth,
  unbudgeted,
} from "@/domain/budgets";
import { goalCurrent, goalStatus, monthsLeft, requiredMonthly } from "@/domain/goals";
import { firstDue, nextAfter, occurrences, reminderDate, type Schedule } from "@/domain/recurring";

describe("recurring schedules (docs/04 §11)", () => {
  const monthly31: Schedule = {
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 31,
    startDate: "2026-01-01",
  };

  it("monthly clamps to month end and re-anchors to the day", () => {
    expect(firstDue(monthly31)).toBe("2026-01-31");
    expect(occurrences(monthly31, "2026-01-31", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    expect(nextAfter({ ...monthly31, startDate: "2028-01-01" }, "2028-01-31")).toBe("2028-02-29");
  });

  it("first due is on or after the start date", () => {
    expect(
      firstDue({ frequency: "monthly", interval: 1, dayOfMonth: 5, startDate: "2026-01-10" }),
    ).toBe("2026-02-05");
    expect(firstDue({ frequency: "monthly", interval: 1, startDate: "2026-01-10" })).toBe(
      "2026-01-10",
    );
  });

  it("weekly on a weekday, every N weeks", () => {
    // 2026-01-01 is a Thursday; weekday 1 = Monday.
    const s: Schedule = { frequency: "weekly", interval: 2, weekday: 1, startDate: "2026-01-01" };
    expect(firstDue(s)).toBe("2026-01-05");
    expect(nextAfter(s, "2026-01-05")).toBe("2026-01-19");
  });

  it("yearly on month/day (29 Feb → 28 Feb in common years) and every N months", () => {
    const y: Schedule = {
      frequency: "yearly",
      interval: 1,
      monthOfYear: 2,
      dayOfMonth: 29,
      startDate: "2027-03-01",
    };
    expect(firstDue(y)).toBe("2028-02-29");
    expect(nextAfter(y, "2028-02-29")).toBe("2029-02-28");
    const q: Schedule = {
      frequency: "every_n_months",
      interval: 3,
      dayOfMonth: 15,
      startDate: "2026-01-01",
    };
    expect(occurrences(q, firstDue(q)!, "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
  });

  it("stops at the end date; reminders are N days before", () => {
    const s: Schedule = { ...monthly31, endDate: "2026-03-15" };
    expect(nextAfter(s, "2026-02-28")).toBeNull();
    expect(firstDue({ ...monthly31, endDate: "2026-01-15" })).toBeNull();
    expect(reminderDate("2026-03-01", 2)).toBe("2026-02-27");
  });
});

describe("budgets (docs/04 §13)", () => {
  const parentOf = new Map<string, string | null>([
    ["food", null],
    ["groceries", "food"],
    ["dining", "food"],
    ["transport", null],
    ["fuel", "transport"],
  ]);
  const lines = [
    { categoryId: "groceries", amountMinor: 30_000 }, // a split line
    { categoryId: "dining", amountMinor: 10_000 },
    { categoryId: "food", amountMinor: 5_000 },
    { categoryId: "fuel", amountMinor: 8_000 },
    { categoryId: "groceries", amountMinor: 2_000 },
  ];

  it("actual includes child categories and split lines", () => {
    const a = budgetActuals(lines, parentOf, [
      { categoryId: "food", amountMinor: 50_000 },
      { categoryId: "groceries", amountMinor: 30_000 },
    ]);
    expect(a.get("food")).toBe(47_000);
    expect(a.get("groceries")).toBe(32_000);
  });

  it("unbudgeted = categories neither budgeted nor under a budgeted parent; totals count once", () => {
    const ids = new Set(["food", "groceries"]);
    expect([...unbudgeted(lines, parentOf, ids)]).toEqual([["fuel", 8_000]]);
    expect(budgetedSpendTotal(lines, parentOf, ids)).toBe(47_000);
    expect(
      budgetTotal(
        [
          { categoryId: "food", amountMinor: 50_000 },
          { categoryId: "groceries", amountMinor: 30_000 },
          { categoryId: "transport", amountMinor: 20_000 },
        ],
        parentOf,
      ),
    ).toBe(70_000);
  });

  it("status: ok < 80% ≤ warn < 100% ≤ over", () => {
    expect(budgetStatus(7_999, 10_000)).toEqual({ usedBp: 7_999, status: "ok" });
    expect(budgetStatus(8_000, 10_000).status).toBe("warn");
    expect(budgetStatus(10_000, 10_000).status).toBe("over");
    expect(budgetStatus(999_999, 1_000_000)).toEqual({ usedBp: 10_000, status: "warn" });
    expect(budgetStatus(79_999, 100_000).status).toBe("ok");
    expect(budgetStatus(0, 0)).toEqual({ usedBp: 0, status: "ok" });
  });

  it("copy forward skips categories already budgeted; previous month wraps the year", () => {
    expect(
      copyForward(
        [
          { categoryId: "food", amountMinor: 1 },
          { categoryId: "fuel", amountMinor: 2 },
        ],
        [{ categoryId: "food", amountMinor: 9 }],
      ),
    ).toEqual([{ categoryId: "fuel", amountMinor: 2 }]);
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-10")).toBe("2026-09");
  });
});

describe("goals (docs/04 §13)", () => {
  it("current = Σ value × share; negative balances count as 0", () => {
    expect(
      goalCurrent([
        { valueMinor: 1_000_000, shareBp: 5000 },
        { valueMinor: 333, shareBp: 10_000 },
        { valueMinor: -50_000, shareBp: 10_000 },
      ]),
    ).toBe(500_333);
  });

  it("months left", () => {
    expect(monthsLeft("2026-01-07", "2026-07-07")).toBe(6);
    expect(monthsLeft("2026-01-07", "2026-07-06")).toBe(5);
    expect(monthsLeft("2026-01-07", "2026-01-20")).toBe(1);
    expect(monthsLeft("2026-01-07", "2026-01-07")).toBe(0);
  });

  it("required monthly: r = 0 and with a return", () => {
    expect(requiredMonthly(1_200_000, 0, 12, 0)).toBe(100_000);
    // 10% a year, 12 months, from 0 to 1,200,000.00 → 95,499.06 a month (future-value annuity)
    expect(requiredMonthly(120_000_000, 0, 12, 1000)).toBe(9_549_906);
    expect(requiredMonthly(100, 200, 12, 0)).toBe(0);
    expect(requiredMonthly(1_000, 400, 0, 0)).toBe(600);
  });

  it("status: achieved, overdue, on track within 110% of the average contribution", () => {
    const base = { targetMinor: 1_000, currentMinor: 0, months: 10, requiredMonthlyMinor: 110 };
    expect(goalStatus({ ...base, currentMinor: 1_000, avgMonthlyContributionMinor: 0 })).toBe(
      "achieved",
    );
    expect(goalStatus({ ...base, months: 0, avgMonthlyContributionMinor: 999 })).toBe("overdue");
    expect(goalStatus({ ...base, avgMonthlyContributionMinor: 100 })).toBe("on_track");
    expect(goalStatus({ ...base, avgMonthlyContributionMinor: 99 })).toBe("off_track");
  });
});
