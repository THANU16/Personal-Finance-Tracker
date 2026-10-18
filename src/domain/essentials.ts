// docs/04 §13 — emergency fund target. Pure: averages are computed by the caller (Phase 10).

export const EMERGENCY_BASES = ["essential", "all", "manual"] as const;
export type EmergencyBasis = (typeof EMERGENCY_BASES)[number];

export interface EmergencyTargetInput {
  months: number;
  basis: EmergencyBasis;
  manualMonthlyMinor?: number | null;
  /** Average monthly expense in essential categories over the last 6 complete months. */
  averageEssentialMinor: number;
  /** Average monthly expense in all categories over the last 6 complete months. */
  averageAllMinor: number;
  overrideMinor?: number | null;
}

export interface EmergencyTarget {
  monthlyBasisMinor: number;
  targetMinor: number;
  /** The basis actually applied: "essential" falls back to "all" when nothing essential was spent. */
  basisUsed: EmergencyBasis;
}

/** target = override ?? monthly basis × months. All amounts are integer minor units. */
export function emergencyTarget(input: EmergencyTargetInput): EmergencyTarget {
  let basisUsed: EmergencyBasis = input.basis;
  let monthlyBasisMinor: number;
  if (input.basis === "manual") {
    monthlyBasisMinor = input.manualMonthlyMinor ?? 0;
  } else if (input.basis === "essential" && input.averageEssentialMinor > 0) {
    monthlyBasisMinor = input.averageEssentialMinor;
  } else {
    basisUsed = "all";
    monthlyBasisMinor = input.averageAllMinor;
  }
  const override = input.overrideMinor ?? null;
  const targetMinor = override ?? monthlyBasisMinor * input.months;
  if (!Number.isSafeInteger(targetMinor)) throw new RangeError("Emergency target is out of range");
  return { monthlyBasisMinor, targetMinor, basisUsed };
}
