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

// ------------------------------------------------------------------------------- repeating goals
// A repeating goal (yearly insurance, school fees every 6 months, a car service every 8 months…)
// has a per-cycle target and a due date that moves forward by `every` months/years each cycle.

export const RECURRENCE_UNITS = ["month", "year"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export interface Recurrence {
  every: number;
  unit: RecurrenceUnit;
  /** Due date of cycle `anchorCycle` (`YYYY-MM-DD`); later due dates are counted from it. */
  anchorDate: string;
  anchorCycle: number;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * `YYYY-MM-DD` + n months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb).
 * Always counted from the given date, so repeating from an anchor never drifts.
 */
export function addMonthsToDate(date: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError("months must be an integer");
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Months in one period: every N months, or every N years × 12. */
export function periodMonths(r: Pick<Recurrence, "every" | "unit">): number {
  return r.unit === "year" ? r.every * 12 : r.every;
}

/** Due date of cycle `cycleNo` = anchorDate + (cycleNo − anchorCycle) periods. */
export function dueDateOfCycle(r: Recurrence, cycleNo: number): string {
  return addMonthsToDate(r.anchorDate, (cycleNo - r.anchorCycle) * periodMonths(r));
}

/** "Every year", "Every 2 years", "Every month", "Every 8 months". */
export function describeRecurrence(r: Pick<Recurrence, "every" | "unit">): string {
  if (r.every === 1) return `Every ${r.unit}`;
  return `Every ${r.every} ${r.unit}s`;
}
