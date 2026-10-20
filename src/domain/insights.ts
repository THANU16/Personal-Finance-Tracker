// Deterministic insights (docs/04 §22). Pure: the caller gathers the numbers; at most 5, ranked.

export interface InsightsInput {
  /** Day of month today (user tz). */
  dayOfMonth: number;
  /** Expense this month so far vs the 3 complete months before (average), per category. */
  categories: { categoryId: string; name: string; thisMonthMinor: number; avg3Minor: number }[];
  /** Fees paid this quarter and amounts invested this quarter. */
  feesQuarterMinor: number;
  investedQuarterMinor: number;
  staleCount: number;
  fdMaturing30: { holdingId: string; name: string; maturityDate: string }[];
  /** Budgets this month with spent/limit. */
  budgets: { categoryId: string; name: string; spentMinor: number; limitMinor: number }[];
  freeCashMinor: number;
  avgMonthlyExpenseMinor: number;
  emergencyFull: boolean;
  offTargetCount: number;
  missedSipCount: number;
  /** Savings rate of the last complete month and the month before (bp; null without income). */
  savingsRateBp: number | null;
  previousSavingsRateBp: number | null;
}

export type InsightKey =
  | "budget_early"
  | "savings_down"
  | "missed_sip"
  | "drift"
  | "idle_cash"
  | "category_spike"
  | "fees_high"
  | "stale_values"
  | "fd_maturing";

export interface Insight {
  key: InsightKey;
  severity: "info" | "warning";
  title: string;
  body: string;
  href: string;
}

/** Fees above 1% of the amount invested this quarter count as high (Phase 10 decision). */
export const FEE_THRESHOLD_BP = 100;
const RANK: InsightKey[] = [
  "budget_early",
  "savings_down",
  "missed_sip",
  "drift",
  "idle_cash",
  "category_spike",
  "fees_high",
  "fd_maturing",
  "stale_values",
];

const pct = (bp: number) => `${Math.round(bp / 100)}%`;

export function computeInsights(input: InsightsInput, max = 5): Insight[] {
  const out: Insight[] = [];
  const early = input.budgets.filter(
    (b) => b.limitMinor > 0 && b.spentMinor * 10 >= b.limitMinor * 8 && input.dayOfMonth < 20,
  );
  if (early.length) {
    out.push({
      key: "budget_early",
      severity: "warning",
      title: `${early.length === 1 ? early[0]!.name : `${early.length} budgets`} at 80% before the 20th`,
      body: "Spending is running ahead of the month.",
      href: "/budgets",
    });
  }
  if (
    input.savingsRateBp !== null &&
    input.previousSavingsRateBp !== null &&
    input.previousSavingsRateBp - input.savingsRateBp >= 1_000
  ) {
    out.push({
      key: "savings_down",
      severity: "warning",
      title: "Savings rate down",
      body: `Last month ${pct(input.savingsRateBp)} vs ${pct(input.previousSavingsRateBp)} the month before.`,
      href: "/reports",
    });
  }
  if (input.missedSipCount > 0) {
    out.push({
      key: "missed_sip",
      severity: "warning",
      title: `${input.missedSipCount} missed SIP${input.missedSipCount === 1 ? "" : "s"}`,
      body: "A planned investment was not made.",
      href: "/sip",
    });
  }
  if (input.offTargetCount > 0) {
    out.push({
      key: "drift",
      severity: "info",
      title: `${input.offTargetCount} class${input.offTargetCount === 1 ? "" : "es"} off target`,
      body: "Allocation has drifted beyond the tolerance band.",
      href: "/rebalancing?tab=actual",
    });
  }
  if (
    input.emergencyFull &&
    input.avgMonthlyExpenseMinor > 0 &&
    input.freeCashMinor > 3 * input.avgMonthlyExpenseMinor
  ) {
    out.push({
      key: "idle_cash",
      severity: "info",
      title: "Idle free cash",
      body: "Free cash is above 3 months of expenses and the emergency fund is full — consider investing it.",
      href: "/rebalancing?tab=rebalance",
    });
  }
  const spikes = input.categories
    .filter((c) => c.avg3Minor > 0 && c.thisMonthMinor * 10 > c.avg3Minor * 13)
    .sort((a, b) => b.thisMonthMinor / b.avg3Minor - a.thisMonthMinor / a.avg3Minor);
  if (spikes.length) {
    const c = spikes[0]!;
    out.push({
      key: "category_spike",
      severity: "info",
      title: `${c.name} spending up`,
      body: `This month is more than 30% above its 3-month average${spikes.length > 1 ? ` (and ${spikes.length - 1} more)` : ""}.`,
      href: `/transactions?category=${c.categoryId}`,
    });
  }
  if (
    input.feesQuarterMinor > 0 &&
    input.feesQuarterMinor * 10_000 > input.investedQuarterMinor * FEE_THRESHOLD_BP
  ) {
    out.push({
      key: "fees_high",
      severity: "info",
      title: "Fees this quarter",
      body: "Fees are above 1% of what you invested this quarter.",
      href: "/reports",
    });
  }
  if (input.fdMaturing30.length) {
    const f = input.fdMaturing30[0]!;
    out.push({
      key: "fd_maturing",
      severity: "info",
      title:
        input.fdMaturing30.length === 1
          ? `${f.name} matures soon`
          : `${input.fdMaturing30.length} FDs mature soon`,
      body: `First maturity ${f.maturityDate}.`,
      href: `/assets/${f.holdingId}`,
    });
  }
  if (input.staleCount > 0) {
    out.push({
      key: "stale_values",
      severity: "info",
      title: `${input.staleCount} stale value${input.staleCount === 1 ? "" : "s"}`,
      body: "Update holding values so totals stay accurate.",
      href: "/assets/update-values",
    });
  }
  return out.sort((a, b) => RANK.indexOf(a.key) - RANK.indexOf(b.key)).slice(0, max);
}
