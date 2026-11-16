import { describe, expect, it } from "vitest";
import {
  addMonthsToDate,
  describeRecurrence,
  dueDateOfCycle,
  periodMonths,
  type Recurrence,
} from "@/domain/goals";

// Repeating goals (docs/04 §13): the due date moves forward one period per completed cycle.
const rec = (every: number, unit: Recurrence["unit"], anchorDate: string, anchorCycle = 0) => ({
  every,
  unit,
  anchorDate,
  anchorCycle,
});

describe("addMonthsToDate", () => {
  it("adds months across years, both ways", () => {
    expect(addMonthsToDate("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsToDate("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonthsToDate("2026-03-01", 0)).toBe("2026-03-01");
  });

  it("clamps to the last day of shorter months, leap years included", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsToDate("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsToDate("2026-08-31", 1)).toBe("2026-09-30");
  });
});

describe("dueDateOfCycle", () => {
  it("every year", () => {
    const r = rec(1, "year", "2027-03-01");
    expect([0, 1, 2].map((c) => dueDateOfCycle(r, c))).toEqual([
      "2027-03-01",
      "2028-03-01",
      "2029-03-01",
    ]);
  });

  it("every 2 years", () => {
    const r = rec(2, "year", "2026-06-10");
    expect(dueDateOfCycle(r, 1)).toBe("2028-06-10");
    expect(dueDateOfCycle(r, 3)).toBe("2032-06-10");
  });

  it("every 8 months", () => {
    const r = rec(8, "month", "2026-12-05");
    expect([1, 2, 3].map((c) => dueDateOfCycle(r, c))).toEqual([
      "2027-08-05",
      "2028-04-05",
      "2028-12-05",
    ]);
  });

  it("counts from the anchor, so month-end dates never drift (31 Jan monthly)", () => {
    const r = rec(1, "month", "2026-01-31");
    expect([1, 2, 3].map((c) => dueDateOfCycle(r, c))).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("29 Feb yearly: 28 Feb in common years, 29 Feb again in leap years", () => {
    const r = rec(1, "year", "2028-02-29");
    expect([1, 4].map((c) => dueDateOfCycle(r, c))).toEqual(["2029-02-28", "2032-02-29"]);
  });

  it("a re-anchored schedule counts from its anchor cycle", () => {
    const r = rec(6, "month", "2027-05-20", 3);
    expect(dueDateOfCycle(r, 3)).toBe("2027-05-20");
    expect(dueDateOfCycle(r, 4)).toBe("2027-11-20");
  });
});

describe("describeRecurrence / periodMonths", () => {
  it("labels and period lengths", () => {
    expect(describeRecurrence({ every: 1, unit: "year" })).toBe("Every year");
    expect(describeRecurrence({ every: 2, unit: "year" })).toBe("Every 2 years");
    expect(describeRecurrence({ every: 1, unit: "month" })).toBe("Every month");
    expect(describeRecurrence({ every: 8, unit: "month" })).toBe("Every 8 months");
    expect(periodMonths({ every: 2, unit: "year" })).toBe(24);
    expect(periodMonths({ every: 8, unit: "month" })).toBe(8);
  });
});
