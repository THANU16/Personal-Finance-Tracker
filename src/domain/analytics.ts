// docs/04 §4, §21, §22 — flow bucketing, compare and standing ratios. Pure, integer minor units.
import type { Bucket } from "@/domain/date-range";
import { divRound } from "@/domain/money";

/** One business day of flows, already converted to base. */
export interface DailyFlow {
  day: string;
  incomeMinor: number;
  investmentIncomeMinor: number;
  expenseMinor: number;
  /** Invest amounts excluding fees (investment rate). */
  investMinor: number;
}

export interface FlowPoint {
  key: string;
  start: string;
  end: string;
  /** Income incl. investment income paid out (docs/04 §4). */
  incomeMinor: number;
  investmentIncomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
  /** null when income is 0. */
  savingsRateBp: number | null;
  investMinor: number;
}

/** ratio in bp, null when the denominator is not positive. */
export function ratioBp(numerator: number, denominator: number): number | null {
  return denominator > 0 ? divRound(numerator * 10_000, denominator) : null;
}

/** Flows are SUMMED per bucket; every bucket is returned (zeros when empty). */
export function bucketFlows(days: readonly DailyFlow[], buckets: readonly Bucket[]): FlowPoint[] {
  const points: FlowPoint[] = buckets.map((b) => ({
    key: b.key,
    start: b.start,
    end: b.end,
    incomeMinor: 0,
    investmentIncomeMinor: 0,
    expenseMinor: 0,
    savingsMinor: 0,
    savingsRateBp: null,
    investMinor: 0,
  }));
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  let bi = 0;
  for (const d of sorted) {
    while (bi < points.length && d.day > points[bi]!.end) bi += 1;
    if (bi >= points.length) break;
    const p = points[bi]!;
    if (d.day < p.start) continue;
    p.incomeMinor += d.incomeMinor + d.investmentIncomeMinor;
    p.investmentIncomeMinor += d.investmentIncomeMinor;
    p.expenseMinor += d.expenseMinor;
    p.investMinor += d.investMinor;
  }
  for (const p of points) {
    p.savingsMinor = p.incomeMinor - p.expenseMinor;
    p.savingsRateBp = ratioBp(p.savingsMinor, p.incomeMinor);
  }
  return points;
}

export interface FlowTotals {
  incomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
  savingsRateBp: number | null;
  investMinor: number;
  /** Σ invest ÷ income (docs/04 §22). */
  investmentRateBp: number | null;
}

export function flowTotals(points: readonly FlowPoint[]): FlowTotals {
  const income = points.reduce((s, p) => s + p.incomeMinor, 0);
  const expense = points.reduce((s, p) => s + p.expenseMinor, 0);
  const invest = points.reduce((s, p) => s + p.investMinor, 0);
  return {
    incomeMinor: income,
    expenseMinor: expense,
    savingsMinor: income - expense,
    savingsRateBp: ratioBp(income - expense, income),
    investMinor: invest,
    investmentRateBp: ratioBp(invest, income),
  };
}

export interface Change {
  currentMinor: number;
  previousMinor: number;
  deltaMinor: number;
  /** null when the previous value is 0. */
  pctBp: number | null;
}

/** % change uses |previous| so a smaller loss reads as an improvement. */
export function changeOf(currentMinor: number, previousMinor: number): Change {
  const deltaMinor = currentMinor - previousMinor;
  return {
    currentMinor,
    previousMinor,
    deltaMinor,
    pctBp: previousMinor === 0 ? null : divRound(deltaMinor * 10_000, Math.abs(previousMinor)),
  };
}

/** Previous-period values aligned bucket by bucket (index); missing buckets are null. */
export function alignPrevious<T>(
  current: readonly unknown[],
  previous: readonly T[],
): (T | null)[] {
  return current.map((_, i) => previous[i] ?? null);
}

/** Runway in tenths of a month: liquid ÷ average monthly expense (null without expense). */
export function runwayTenths(liquidMinor: number, avgMonthlyExpenseMinor: number): number | null {
  if (avgMonthlyExpenseMinor <= 0) return null;
  return divRound(Math.max(0, liquidMinor) * 10, avgMonthlyExpenseMinor);
}

export interface UpcomingLike {
  dueDate: string;
  posted?: boolean;
  outflowMinor?: number | null;
}

/** docs/04 §21: free cash − Σ outflows of unposted items due on or before month end. */
export function safeToSpend(
  freeCashMinor: number,
  items: readonly UpcomingLike[],
  monthEndKey: string,
): { safeMinor: number; committedMinor: number } {
  const committed = items
    .filter((i) => !i.posted && i.dueDate <= monthEndKey && (i.outflowMinor ?? 0) > 0)
    .reduce((s, i) => s + (i.outflowMinor ?? 0), 0);
  return { safeMinor: freeCashMinor - committed, committedMinor: committed };
}
