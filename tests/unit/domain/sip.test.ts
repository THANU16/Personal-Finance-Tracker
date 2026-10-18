import { describe, expect, it } from "vitest";
import {
  carryIn,
  consistencyBp,
  estimatedShareMinor,
  executionStatus,
  isMissed,
  isOnTime,
  monthlyDueDate,
  monthsSince,
  periodKeyOf,
  periodsUntil,
  steppedAmount,
  versionFor,
} from "@/domain/sip";

describe("due dates and periods", () => {
  it("day 31 means the last day; February and leap years clamp", () => {
    expect(monthlyDueDate(2026, 1, 31)).toBe("2026-02-28");
    expect(monthlyDueDate(2028, 1, 31)).toBe("2028-02-29");
    expect(monthlyDueDate(2026, 3, 31)).toBe("2026-04-30");
    expect(monthlyDueDate(2026, 0, 15)).toBe("2026-01-15");
  });

  it("monthly periods start at startDate and stop at endDate", () => {
    const p = periodsUntil(
      { frequency: "monthly", dayOfMonth: 10, startDate: "2026-01-15", endDate: "2026-05-10" },
      "2026-12-31",
    );
    expect(p).toEqual([
      { periodKey: "2026-02", dueDate: "2026-02-10" },
      { periodKey: "2026-03", dueDate: "2026-03-10" },
      { periodKey: "2026-04", dueDate: "2026-04-10" },
      { periodKey: "2026-05", dueDate: "2026-05-10" },
    ]);
  });

  it("monthly crosses the year boundary", () => {
    const p = periodsUntil(
      { frequency: "monthly", dayOfMonth: 31, startDate: "2025-11-01" },
      "2026-02-28",
    );
    expect(p.map((x) => x.dueDate)).toEqual([
      "2025-11-30",
      "2025-12-31",
      "2026-01-31",
      "2026-02-28",
    ]);
  });

  it("weekly: next weekday from startDate; ISO week keys across the year boundary", () => {
    const p = periodsUntil(
      { frequency: "weekly", weekday: 1, startDate: "2025-12-24" },
      "2026-01-12",
    );
    expect(p).toEqual([
      { periodKey: "2026-W01", dueDate: "2025-12-29" }, // ISO week-year 2026
      { periodKey: "2026-W02", dueDate: "2026-01-05" },
      { periodKey: "2026-W03", dueDate: "2026-01-12" },
    ]);
    expect(periodKeyOf("2025-12-29", "weekly")).toBe("2026-W01"); // ISO week-year
  });

  it("nothing before startDate or after until", () => {
    expect(
      periodsUntil({ frequency: "monthly", dayOfMonth: 5, startDate: "2026-03-01" }, "2026-02-01"),
    ).toEqual([]);
  });
});

describe("step-up", () => {
  it("round(amount × (1+p)^floor(months/every)) in whole major units", () => {
    const s = { percentBp: 1_000, everyMonths: 12 };
    expect(steppedAmount(25_000_00, "LKR", s, "2026-01-10", "2026-12-10")).toBe(25_000_00);
    expect(steppedAmount(25_000_00, "LKR", s, "2026-01-10", "2027-01-10")).toBe(27_500_00);
    expect(steppedAmount(25_000_00, "LKR", s, "2026-01-10", "2028-01-10")).toBe(30_250_00);
    // 10,000.50 × 1.05 = 10,500.525 → 10,501 (whole units)
    expect(
      steppedAmount(
        10_000_50,
        "LKR",
        { percentBp: 500, everyMonths: 6 },
        "2026-01-01",
        "2026-07-01",
      ),
    ).toBe(10_501_00);
    expect(
      steppedAmount(100, "JPY", { percentBp: 1_000, everyMonths: 1 }, "2026-01-01", "2026-02-01"),
    ).toBe(110);
  });

  it("no step-up returns the amount", () => {
    expect(steppedAmount(1_234, "LKR", null, "2026-01-01", "2030-01-01")).toBe(1_234);
  });

  it("monthsSince counts a month once its day is reached (month-end aware)", () => {
    expect(monthsSince("2026-01-31", "2026-02-28")).toBe(1);
    expect(monthsSince("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsSince("2026-01-15", "2026-02-15")).toBe(1);
  });
});

describe("carry-forward", () => {
  it("only after missed or partial, and only with carry_forward", () => {
    const partial = {
      status: "partial" as const,
      plannedTotalMinor: 30_000,
      actualTotalMinor: 18_000,
    };
    expect(carryIn("carry_forward", partial)).toBe(12_000);
    expect(carryIn("carry_forward", { ...partial, status: "missed", actualTotalMinor: 0 })).toBe(
      30_000,
    );
    expect(carryIn("carry_forward", { ...partial, status: "done", actualTotalMinor: 30_000 })).toBe(
      0,
    );
    expect(carryIn("carry_forward", { ...partial, status: "skipped" })).toBe(0);
    expect(carryIn("skip", partial)).toBe(0);
    expect(carryIn("carry_forward", null)).toBe(0);
  });
});

describe("versions, missed, status, on time", () => {
  it("version = greatest effectiveFrom ≤ dueDate", () => {
    const v = [
      { version: 1, effectiveFrom: "2026-01-01" },
      { version: 2, effectiveFrom: "2026-04-10" },
    ];
    expect(versionFor(v, "2026-04-09")?.version).toBe(1);
    expect(versionFor(v, "2026-04-10")?.version).toBe(2);
    expect(versionFor(v, "2025-12-31")).toBeNull();
  });

  it("missed after the grace period", () => {
    expect(isMissed("due", "2026-03-10", 7, "2026-03-17")).toBe(false);
    expect(isMissed("due", "2026-03-10", 7, "2026-03-18")).toBe(true);
    expect(isMissed("done", "2026-03-10", 7, "2026-04-18")).toBe(false);
  });

  it("done when actual ≥ planned (over-investing allowed); partial below; zero rejected", () => {
    expect(executionStatus(25_000, 25_000)).toBe("done");
    expect(executionStatus(25_000, 30_000)).toBe("done");
    expect(executionStatus(25_000, 1)).toBe("partial");
    expect(() => executionStatus(25_000, 0)).toThrow(RangeError);
  });

  it("on time within the grace period", () => {
    expect(isOnTime("2026-03-17", "2026-03-10", 7)).toBe(true);
    expect(isOnTime("2026-03-18", "2026-03-10", 7)).toBe(false);
  });
});

describe("consistency", () => {
  it("on-time done ÷ executions due so far; skipped count as not on time", () => {
    expect(
      consistencyBp(
        [
          { status: "done", dueDate: "2026-01-10", onTime: true },
          { status: "done", dueDate: "2026-02-10", onTime: false },
          { status: "skipped", dueDate: "2026-03-10" },
          { status: "partial", dueDate: "2026-04-10", onTime: true },
          { status: "due", dueDate: "2026-05-10" }, // future
        ],
        "2026-04-30",
      ),
    ).toBe(2_500);
    expect(consistencyBp([], "2026-01-01")).toBeNull();
  });
});

describe("estimated share", () => {
  it("holding value × plan invested ÷ holding invested", () => {
    expect(estimatedShareMinor(120_000, 50_000, 100_000)).toBe(60_000);
    expect(estimatedShareMinor(120_000, 0, 100_000)).toBe(0);
    expect(estimatedShareMinor(120_000, 150_000, 100_000)).toBe(120_000); // capped at the whole holding
  });
});
