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

/** Months the emergency fund covers, in tenths (null without a monthly basis). */
export function coverageTenths(currentMinor: number, monthlyBasisMinor: number): number | null {
  if (monthlyBasisMinor <= 0) return null;
  return Math.floor((Math.max(0, currentMinor) * 10) / monthlyBasisMinor);
}

export type ProgressTone = "red" | "amber" | "green";

/** Progress in bp (capped at 10000) and its colour: red < 50%, amber 50–99%, green ≥ 100% (Phase 10). */
export function emergencyProgress(
  currentMinor: number,
  targetMinor: number,
): { progressBp: number; tone: ProgressTone } {
  if (targetMinor <= 0) return { progressBp: 0, tone: "red" };
  if (currentMinor >= targetMinor) return { progressBp: 10_000, tone: "green" };
  const progressBp = Math.floor((Math.max(0, currentMinor) * 10_000) / targetMinor);
  return { progressBp, tone: progressBp < 5_000 ? "red" : "amber" };
}

/** Life cover target = income of the last 12 months × multiple (docs/04 §13). */
export function lifeCoverTarget(annualIncomeMinor: number, multiple: number): number {
  return Math.max(0, annualIncomeMinor) * Math.max(0, multiple);
}

export interface HealthInput {
  emergencyCurrentMinor: number;
  emergencyTargetMinor: number;
  lifeCoverMinor: number;
  lifeTargetMinor: number;
  healthCoverMinor: number;
  /** null: no health cover target set (that half scores 0). */
  healthTargetMinor: number | null;
  /** null: no income to compare with. */
  dtiBp: number | null;
  hasDebtPayments: boolean;
  /** Savings rate of the last 3 complete months; null without income. */
  savingsRateBp: number | null;
}

export type HealthPart = "emergency" | "insurance" | "debt" | "savings";

export interface HealthScore {
  score: number;
  /** Points per part, one decimal. */
  parts: Record<HealthPart, { points: number; max: number }>;
  /** The (up to) two parts losing the most points, with a short reason. */
  reasons: { part: HealthPart; text: string }[];
}

const ratio = (have: number, want: number | null) =>
  want === null || want <= 0 ? 0 : Math.min(1, Math.max(0, have) / want);

/** 1 at `good` or better, 0 at `bad` or worse, linear between (works for either direction). */
const band = (value: number, good: number, bad: number) =>
  Math.min(1, Math.max(0, (value - bad) / (good - bad)));

const tenth = (x: number) => Math.round(x * 10) / 10;

/**
 * Health score 0–100 (docs/04 §13): emergency 30 × min(1, current/target); insurance 12.5 life +
 * 12.5 health, each min(1, cover/target); debt 20 (DTI ≤ 30% → 20, ≥ 60% → 0); savings 25
 * (rate ≥ 30% → 25, ≤ 0 → 0). Without income DTI is unknown: 20 with no debt payments, else 0.
 */
export function healthScore(input: HealthInput): HealthScore {
  const emergency = 30 * ratio(input.emergencyCurrentMinor, input.emergencyTargetMinor);
  const life = 12.5 * ratio(input.lifeCoverMinor, input.lifeTargetMinor);
  const health = 12.5 * ratio(input.healthCoverMinor, input.healthTargetMinor);
  const debt =
    input.dtiBp === null ? (input.hasDebtPayments ? 0 : 20) : 20 * band(input.dtiBp, 3_000, 6_000);
  const savings = input.savingsRateBp === null ? 0 : 25 * band(input.savingsRateBp, 3_000, 0);
  const parts: HealthScore["parts"] = {
    emergency: { points: tenth(emergency), max: 30 },
    insurance: { points: tenth(life + health), max: 25 },
    debt: { points: tenth(debt), max: 20 },
    savings: { points: tenth(savings), max: 25 },
  };
  const text: Record<HealthPart, string> = {
    emergency:
      input.emergencyTargetMinor <= 0
        ? "No emergency fund target yet"
        : "Emergency fund below target",
    insurance:
      input.healthTargetMinor === null
        ? "Set a health cover target"
        : life < 12.5
          ? "Life cover below target"
          : "Health cover below target",
    debt:
      input.dtiBp === null
        ? "Loan payments with no income recorded"
        : "Debt payments high vs income",
    savings: input.savingsRateBp === null ? "No income recorded" : "Savings rate below 30%",
  };
  const reasons = (Object.keys(parts) as HealthPart[])
    .map((part) => ({ part, lost: parts[part].max - parts[part].points }))
    .filter((r) => r.lost > 0.05)
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 2)
    .map((r) => ({ part: r.part, text: text[r.part] }));
  return {
    score: Math.round(emergency + life + health + debt + savings),
    parts,
    reasons,
  };
}
