import { describe, expect, it } from "vitest";
import {
  coverageTenths,
  emergencyProgress,
  emergencyTarget,
  healthScore,
  lifeCoverTarget,
} from "@/domain/essentials";

const base = { months: 6, averageEssentialMinor: 80_000_00, averageAllMinor: 150_000_00 };

describe("emergencyTarget", () => {
  it("uses the essential average × months by default", () => {
    expect(emergencyTarget({ ...base, basis: "essential" })).toEqual({
      monthlyBasisMinor: 80_000_00,
      targetMinor: 480_000_00,
      basisUsed: "essential",
    });
  });

  it("falls back to all expenses when the essential average is 0", () => {
    expect(emergencyTarget({ ...base, basis: "essential", averageEssentialMinor: 0 })).toEqual({
      monthlyBasisMinor: 150_000_00,
      targetMinor: 900_000_00,
      basisUsed: "all",
    });
  });

  it("uses all expenses when asked", () => {
    const r = emergencyTarget({ ...base, basis: "all" });
    expect(r.targetMinor).toBe(900_000_00);
    expect(r.basisUsed).toBe("all");
  });

  it("manual ignores the averages", () => {
    expect(emergencyTarget({ ...base, basis: "manual", manualMonthlyMinor: 100_000_00 })).toEqual({
      monthlyBasisMinor: 100_000_00,
      targetMinor: 600_000_00,
      basisUsed: "manual",
    });
  });

  it("manual without an amount gives a zero target", () => {
    expect(
      emergencyTarget({ ...base, basis: "manual", manualMonthlyMinor: null }).targetMinor,
    ).toBe(0);
  });

  it("the override wins over every basis", () => {
    for (const basis of ["essential", "all", "manual"] as const) {
      const r = emergencyTarget({
        ...base,
        basis,
        manualMonthlyMinor: 1,
        overrideMinor: 1_000_000_00,
      });
      expect(r.targetMinor).toBe(1_000_000_00);
    }
    // monthly basis is still reported so coverage months can be computed
    expect(emergencyTarget({ ...base, basis: "all", overrideMinor: 5 }).monthlyBasisMinor).toBe(
      150_000_00,
    );
  });

  it("is exact integer maths", () => {
    expect(
      emergencyTarget({ ...base, basis: "all", averageAllMinor: 33_333, months: 7 }).targetMinor,
    ).toBe(233_331);
  });
});

describe("coverage and progress", () => {
  it("coverage months in tenths, null without a basis", () => {
    expect(coverageTenths(250_000_00, 100_000_00)).toBe(25);
    expect(coverageTenths(-5, 100)).toBe(0);
    expect(coverageTenths(100, 0)).toBeNull();
  });

  it("progress colours: red < 50%, amber 50–99%, green ≥ 100%", () => {
    expect(emergencyProgress(49_999, 100_000)).toEqual({ progressBp: 4_999, tone: "red" });
    expect(emergencyProgress(50_000, 100_000)).toEqual({ progressBp: 5_000, tone: "amber" });
    expect(emergencyProgress(99_999, 100_000)).toEqual({ progressBp: 9_999, tone: "amber" });
    expect(emergencyProgress(150_000, 100_000)).toEqual({ progressBp: 10_000, tone: "green" });
    expect(emergencyProgress(10, 0).tone).toBe("red");
  });

  it("life cover target = annual income × multiple", () => {
    expect(lifeCoverTarget(3_600_000_00, 10)).toBe(36_000_000_00);
  });
});

describe("healthScore (docs/04 §13)", () => {
  const full = {
    emergencyCurrentMinor: 600,
    emergencyTargetMinor: 600,
    lifeCoverMinor: 1_000,
    lifeTargetMinor: 1_000,
    healthCoverMinor: 500,
    healthTargetMinor: 500,
    dtiBp: 2_000,
    hasDebtPayments: true,
    savingsRateBp: 3_500,
  };

  it("all parts full → 100, no reasons", () => {
    const s = healthScore(full);
    expect(s.score).toBe(100);
    expect(s.reasons).toEqual([]);
  });

  it("linear bands for debt and savings, halves for insurance", () => {
    const s = healthScore({
      ...full,
      emergencyCurrentMinor: 300, // 15
      lifeCoverMinor: 500, // 6.25
      healthTargetMinor: null, // 0
      dtiBp: 4_500, // 10
      savingsRateBp: 1_500, // 12.5
    });
    expect(s.parts.emergency.points).toBe(15);
    expect(s.parts.insurance.points).toBe(6.3);
    expect(s.parts.debt.points).toBe(10);
    expect(s.parts.savings.points).toBe(12.5);
    expect(s.score).toBe(44); // 43.75
    expect(s.reasons.map((r) => r.part)).toEqual(["insurance", "emergency"]);
    expect(s.reasons[0]!.text).toBe("Set a health cover target");
  });

  it("DTI ≥ 60% and savings ≤ 0 score 0; unknown DTI depends on debt payments", () => {
    const s = healthScore({ ...full, dtiBp: 6_000, savingsRateBp: -500 });
    expect(s.parts.debt.points).toBe(0);
    expect(s.parts.savings.points).toBe(0);
    expect(healthScore({ ...full, dtiBp: null, hasDebtPayments: false }).parts.debt.points).toBe(
      20,
    );
    expect(healthScore({ ...full, dtiBp: null, hasDebtPayments: true }).parts.debt.points).toBe(0);
    expect(healthScore({ ...full, savingsRateBp: null }).parts.savings.points).toBe(0);
  });

  it("a zero emergency target scores 0", () => {
    expect(healthScore({ ...full, emergencyTargetMinor: 0 }).parts.emergency.points).toBe(0);
  });
});
