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

// ---------------------------------------------------------------- dashboard insight cards (§25)

/**
 * docs/04 §25.1 — why net worth changed over a period: saved (income − expense, §4) and the
 * investments' market gain (§24.4) are measured; "other" is the rest (currency moves,
 * adjustments, reinvested income, new opening balances), so the three always add up.
 */
export function netWorthBridge(input: {
  startMinor: number;
  endMinor: number;
  savedMinor: number;
  marketGainMinor: number;
}): { changeMinor: number; savedMinor: number; marketGainMinor: number; otherMinor: number } {
  const changeMinor = input.endMinor - input.startMinor;
  return {
    changeMinor,
    savedMinor: input.savedMinor,
    marketGainMinor: input.marketGainMinor,
    otherMinor: changeMinor - input.savedMinor - input.marketGainMinor,
  };
}

export type PaceStatus = "ahead" | "on_pace" | "below" | "no_history";

/**
 * docs/04 §25.3 — spending so far this month vs a usual month (the average of the last complete
 * months). Expected by today = usual × day ÷ days in month. "On pace" within ±2.5% of a usual
 * month of the expected amount.
 */
export function spendingPace(input: {
  spentMinor: number;
  usualMonthMinor: number;
  day: number;
  daysInMonth: number;
}): {
  expectedMinor: number;
  /** spent − expected (positive = ahead of pace). */
  overMinor: number;
  /** Spent and expected as a share of a usual month, in bp (null without history). */
  spentBp: number | null;
  expectedBp: number;
  status: PaceStatus;
} {
  const expectedBp = Math.round((input.day * 10_000) / input.daysInMonth);
  if (input.usualMonthMinor <= 0) {
    return { expectedMinor: 0, overMinor: 0, spentBp: null, expectedBp, status: "no_history" };
  }
  const expectedMinor = Math.round((input.usualMonthMinor * input.day) / input.daysInMonth);
  const overMinor = input.spentMinor - expectedMinor;
  const tolerance = Math.round(input.usualMonthMinor * 0.025);
  return {
    expectedMinor,
    overMinor,
    spentBp: ratioBp(input.spentMinor, input.usualMonthMinor),
    expectedBp,
    status: overMinor > tolerance ? "ahead" : overMinor < -tolerance ? "below" : "on_pace",
  };
}

export type CostKind = "loan_interest" | "bank_fees" | "investment_fees" | "transfer_fees";

/** A posted transaction's fields the fees card needs (amounts already in base). */
export interface CostRow {
  type: string;
  amountMinor: number;
  feeMinor: number;
  interestMinor: number;
  /** System category of an expense: "loan_interest" | "bank_fees" | "investment_fees" | null. */
  costCategory: Exclude<CostKind, "transfer_fees"> | null;
}

/**
 * docs/04 §25.4 — money paid as costs: loan interest (the interest part of loan payments and
 * "Loan interest" expenses), bank fees ("Bank fees" expenses), investment fees (buy / sell fees and
 * "Investment fees" expenses) and transfer fees. Largest first; zero kinds left out.
 */
export function costBreakdown(rows: readonly CostRow[]): {
  totalMinor: number;
  items: { kind: CostKind; amountMinor: number }[];
} {
  const sums: Record<CostKind, number> = {
    loan_interest: 0,
    bank_fees: 0,
    investment_fees: 0,
    transfer_fees: 0,
  };
  for (const r of rows) {
    if (r.type === "debt_payment") sums.loan_interest += r.interestMinor;
    else if (r.type === "transfer") sums.transfer_fees += r.feeMinor;
    else if (r.type === "invest" || r.type === "redeem") sums.investment_fees += r.feeMinor;
    else if (r.type === "expense" && r.costCategory) sums[r.costCategory] += r.amountMinor;
  }
  const items = (Object.keys(sums) as CostKind[])
    .map((kind) => ({ kind, amountMinor: sums[kind] }))
    .filter((i) => i.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);
  return { totalMinor: items.reduce((s, i) => s + i.amountMinor, 0), items };
}
