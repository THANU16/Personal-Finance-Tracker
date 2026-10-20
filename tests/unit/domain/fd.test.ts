import { describe, expect, it } from "vitest";
import {
  daysBetween,
  daysToMaturity,
  fdAccruedInterest,
  lastPayoutDate,
  fdMaturityValue,
  fdPayoutPerPeriod,
  fdValue,
  type FdTerms,
} from "@/domain/fd";

const base: FdTerms = {
  principalMinor: 100_000_000, // 1,000,000.00
  rateBp: 1_000, // 10%
  startDate: "2026-01-01",
  maturityDate: "2027-01-01", // 365 days
  compounding: "simple",
  payout: "at_maturity",
};

describe("fdValue (docs/04 §9)", () => {
  it.each([
    ["simple", 110_000_000], // 1,000,000 × (1 + 0.1)
    ["monthly", 110_471_307], // × (1 + 0.1/12)^12 = 1.104713067 → 1,104,713.07
    ["quarterly", 110_381_289], // × (1.025)^4 = 1.103812891
    ["annually", 110_000_000],
  ] as const)("1,000,000 at 10%% for one year, %s → %s", (compounding, expected) => {
    expect(fdMaturityValue({ ...base, compounding })).toBe(expected);
  });

  it("accrues part of the year (simple, 73 days = 0.2 years)", () => {
    expect(fdValue(base, "2026-03-15")).toBe(102_000_000);
    expect(fdAccruedInterest(base, "2026-03-15")).toBe(2_000_000);
  });

  it("is the principal before or on the start date and caps at maturity", () => {
    expect(fdValue(base, "2026-01-01")).toBe(100_000_000);
    expect(fdValue(base, "2025-12-01")).toBe(100_000_000);
    expect(fdValue(base, "2030-01-01")).toBe(110_000_000);
  });

  it("counts 366 days across a leap year", () => {
    const leap = { ...base, startDate: "2028-01-01", maturityDate: "2029-01-01" };
    expect(daysBetween(leap.startDate, leap.maturityDate)).toBe(366);
    expect(fdMaturityValue(leap)).toBe(110_027_397); // 1 + 0.1 × 366/365
  });

  it("keeps payout FDs at principal and pays interest per period", () => {
    const monthly = { ...base, payout: "monthly" as const };
    expect(fdValue(monthly, "2026-07-01")).toBe(100_000_000);
    expect(fdPayoutPerPeriod(monthly)).toBe(833_333); // 100,000,000 × 0.1 / 12
    expect(fdPayoutPerPeriod({ ...base, payout: "quarterly" })).toBe(2_500_000);
    expect(fdPayoutPerPeriod(base)).toBeNull();
  });

  it("counts days to maturity", () => {
    expect(daysToMaturity(base, "2026-12-25")).toBe(7);
    expect(daysToMaturity(base, "2027-01-03")).toBe(-2);
  });

  it.each([
    ["zero principal", { principalMinor: 0 }],
    ["negative rate", { rateBp: -1 }],
    ["maturity before start", { maturityDate: "2025-12-31" }],
  ])("rejects %s", (_l, override) => {
    expect(() => fdValue({ ...base, ...override }, "2026-06-01")).toThrow(RangeError);
  });
});

describe("lastPayoutDate", () => {
  const t = {
    principalMinor: 1_000_000,
    rateBp: 1_200,
    startDate: "2026-01-31",
    maturityDate: "2026-12-15",
    compounding: "simple" as const,
    payout: "monthly" as const,
  };
  it("monthly payouts clamp to month end; none before the first", () => {
    expect(lastPayoutDate(t, "2026-02-27")).toBeNull();
    expect(lastPayoutDate(t, "2026-02-28")).toBe("2026-02-28");
    expect(lastPayoutDate(t, "2026-04-29")).toBe("2026-03-31");
  });
  it("quarterly, and the last payout is the maturity date", () => {
    expect(lastPayoutDate({ ...t, payout: "quarterly" }, "2026-08-01")).toBe("2026-07-31");
    expect(lastPayoutDate(t, "2027-03-01")).toBe("2026-12-15");
    expect(lastPayoutDate({ ...t, payout: "at_maturity" }, "2027-03-01")).toBeNull();
  });
});
