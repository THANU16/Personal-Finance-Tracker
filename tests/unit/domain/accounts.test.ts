import { describe, expect, it } from "vitest";
import {
  cardOutstandingMinor,
  cardUtilisationBp,
  isLiability,
  nextMonthlyDate,
} from "@/domain/accounts";
import { businessDateToUtc, isDateKey, utcToBusinessDate } from "@/domain/dates";

describe("isLiability", () => {
  it.each([
    ["credit_card", true],
    ["loan", true],
    ["payable", true],
    ["bank", false],
    ["receivable", false],
    ["opportunity_fund", false],
  ] as const)("%s → %s", (type, expected) => {
    expect(isLiability(type)).toBe(expected);
  });
});

describe("card outstanding & utilisation", () => {
  it.each([
    [-25_000, 100_000, 2_500],
    [0, 100_000, 0],
    [5_000, 100_000, 0], // overpaid card: credit, 0% used
    [-120_000, 100_000, 12_000], // over limit
    [-1, 3, 3_333],
  ])("balance %s / limit %s → %sbp", (balance, limit, bp) => {
    expect(cardUtilisationBp(balance, limit)).toBe(bp);
  });

  it("is null without a limit", () => {
    expect(cardUtilisationBp(-100, 0)).toBeNull();
    expect(cardUtilisationBp(-100, null)).toBeNull();
  });

  it("outstanding is the owed amount, never negative", () => {
    expect(cardOutstandingMinor(-25_000)).toBe(25_000);
    expect(cardOutstandingMinor(500)).toBe(0);
  });
});

describe("nextMonthlyDate", () => {
  it.each([
    ["2026-10-18", 25, "2026-10-25"],
    ["2026-10-25", 25, "2026-10-25"], // due today
    ["2026-10-26", 25, "2026-11-25"],
    ["2026-12-20", 5, "2027-01-05"],
    ["2026-02-10", 31, "2026-02-28"], // clamp
    ["2028-02-10", 31, "2028-02-29"], // leap year
    ["2026-01-31", 31, "2026-01-31"],
    ["2026-02-28", 30, "2026-02-28"],
    ["2026-03-01", 30, "2026-03-30"],
  ])("from %s, day %s → %s", (today, day, expected) => {
    expect(nextMonthlyDate(today, day)).toBe(expected);
  });

  it("rejects invalid input", () => {
    expect(() => nextMonthlyDate("2026-10-18", 0)).toThrow(RangeError);
    expect(() => nextMonthlyDate("2026-10-18", 32)).toThrow(RangeError);
    expect(() => nextMonthlyDate("18/10/2026", 5)).toThrow(RangeError);
  });
});

describe("business dates", () => {
  it("stores local midnight in the user's timezone", () => {
    expect(businessDateToUtc("2026-11-01", "Asia/Colombo").toISOString()).toBe(
      "2026-10-31T18:30:00.000Z",
    );
    expect(utcToBusinessDate(new Date("2026-10-31T18:30:00.000Z"), "Asia/Colombo")).toBe(
      "2026-11-01",
    );
  });

  it("round-trips", () => {
    for (const d of ["2026-01-01", "2026-02-28", "2024-02-29", "2026-12-31"]) {
      expect(utcToBusinessDate(businessDateToUtc(d, "Asia/Colombo"), "Asia/Colombo")).toBe(d);
      expect(utcToBusinessDate(businessDateToUtc(d, "America/New_York"), "America/New_York")).toBe(
        d,
      );
    }
  });

  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "", "2026-10-18T00:00"])(
    "rejects %j",
    (bad) => {
      expect(isDateKey(bad)).toBe(false);
      expect(() => businessDateToUtc(bad, "Asia/Colombo")).toThrow(RangeError);
    },
  );
});
