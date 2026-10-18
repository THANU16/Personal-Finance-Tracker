import { describe, expect, it } from "vitest";
import { emergencyTarget } from "@/domain/essentials";

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
