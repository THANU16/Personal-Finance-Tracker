// Goals (docs/04 §13). Pure. Money in minor units, shares and rates in bp, dates as `YYYY-MM-DD`.
import { roundHalfAwayFromZero } from "@/domain/money";

export interface GoalLinkValue {
  valueMinor: number;
  shareBp: number;
}

/** Current = Σ linked value × share (negative balances count as 0). */
export function goalCurrent(links: readonly GoalLinkValue[]): number {
  return links.reduce(
    (s, l) => s + Math.round((Math.max(0, l.valueMinor) * l.shareBp) / 10_000),
    0,
  );
}

/** Whole months from today to the target date (7 Jan → 7 Jul = 6); at least 1 while the date is ahead. */
export function monthsLeft(today: string, targetDate: string): number {
  if (targetDate <= today) return 0;
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const [gy, gm, gd] = targetDate.split("-").map(Number) as [number, number, number];
  return Math.max(1, (gy - ty) * 12 + (gm - tm) - (gd < td ? 1 : 0));
}

/**
 * Required monthly contribution (n months, r = expectedReturnBp / 12):
 * r = 0 → (target − current) / n; else (target − current·(1+r)^n) · r / ((1+r)^n − 1). Never negative.
 */
export function requiredMonthly(
  targetMinor: number,
  currentMinor: number,
  months: number,
  expectedReturnBp: number,
): number {
  if (currentMinor >= targetMinor) return 0;
  if (months <= 0) return targetMinor - currentMinor;
  const r = expectedReturnBp / 10_000 / 12;
  if (r === 0) return Math.ceil((targetMinor - currentMinor) / months);
  const f = Math.pow(1 + r, months);
  return Math.max(0, roundHalfAwayFromZero(((targetMinor - currentMinor * f) * r) / (f - 1)));
}

export type GoalStatus = "achieved" | "on_track" | "off_track" | "overdue";

/** Achieved when current ≥ target; on track when required ≤ 110% of the average contribution. */
export function goalStatus(input: {
  targetMinor: number;
  currentMinor: number;
  months: number;
  requiredMonthlyMinor: number;
  avgMonthlyContributionMinor: number;
}): GoalStatus {
  if (input.currentMinor >= input.targetMinor) return "achieved";
  if (input.months <= 0) return "overdue";
  return input.requiredMonthlyMinor * 10 <= input.avgMonthlyContributionMinor * 11
    ? "on_track"
    : "off_track";
}
