// Reports (docs/05 §15) and the monthly review (Phase 11). Pure: the service gathers ledger
// numbers in base currency; these group, compare and total them.
import type { Insight } from "@/domain/insights";
import { divRound } from "@/domain/money";

export interface Line {
  categoryId: string;
  amountMinor: number;
}

export interface CategoryInfo {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CategoryRow {
  categoryId: string;
  name: string;
  amountMinor: number;
  previousMinor: number;
  /** (amount − previous) ÷ previous in bp; null when previous is 0. */
  changeBp: number | null;
  shareBp: number | null;
  children: { categoryId: string; name: string; amountMinor: number }[];
}

export const changeBp = (current: number, previous: number): number | null =>
  previous > 0 ? divRound((current - previous) * 10_000, previous) : null;

/**
 * Lines rolled up to top-level categories (children listed under their parent), largest first,
 * with the previous period's amount per top-level category.
 */
export function categoryBreakdown(
  lines: readonly Line[],
  categories: readonly CategoryInfo[],
  previous: readonly Line[] = [],
): CategoryRow[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const top = (id: string) => byId.get(id)?.parentId ?? id;
  const rows = new Map<string, CategoryRow>();
  const total = lines.reduce((s, l) => s + l.amountMinor, 0);
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = {
        categoryId: id,
        name: byId.get(id)?.name ?? "Uncategorised",
        amountMinor: 0,
        previousMinor: 0,
        changeBp: null,
        shareBp: null,
        children: [],
      };
      rows.set(id, r);
    }
    return r;
  };
  for (const l of lines) {
    const t = top(l.categoryId);
    const r = row(t);
    r.amountMinor += l.amountMinor;
    if (t !== l.categoryId) {
      const child = r.children.find((c) => c.categoryId === l.categoryId);
      if (child) child.amountMinor += l.amountMinor;
      else
        r.children.push({
          categoryId: l.categoryId,
          name: byId.get(l.categoryId)?.name ?? "Category",
          amountMinor: l.amountMinor,
        });
    }
  }
  for (const l of previous) {
    const t = top(l.categoryId);
    if (rows.has(t)) rows.get(t)!.previousMinor += l.amountMinor;
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      changeBp: changeBp(r.amountMinor, r.previousMinor),
      shareBp: total > 0 ? divRound(r.amountMinor * 10_000, total) : null,
      children: r.children.sort((a, b) => b.amountMinor - a.amountMinor),
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export interface RedemptionLine {
  id: string;
  date: string;
  holdingId: string;
  holdingName: string;
  amountMinor: number;
  feeMinor: number;
  taxMinor: number;
  costRemovedMinor: number;
  realizedGainMinor: number;
}

export interface Totals {
  amountMinor: number;
  feeMinor: number;
  taxMinor: number;
  costRemovedMinor: number;
  realizedGainMinor: number;
}

export function realisedTotals(lines: readonly RedemptionLine[]): Totals {
  return lines.reduce(
    (t, l) => ({
      amountMinor: t.amountMinor + l.amountMinor,
      feeMinor: t.feeMinor + l.feeMinor,
      taxMinor: t.taxMinor + l.taxMinor,
      costRemovedMinor: t.costRemovedMinor + l.costRemovedMinor,
      realizedGainMinor: t.realizedGainMinor + l.realizedGainMinor,
    }),
    { amountMinor: 0, feeMinor: 0, taxMinor: 0, costRemovedMinor: 0, realizedGainMinor: 0 },
  );
}

export interface IncomeLine {
  holdingId: string;
  holdingName: string;
  incomeKind: string;
  grossMinor: number;
  taxMinor: number;
  reinvested: boolean;
}

export interface IncomeRow {
  holdingId: string;
  holdingName: string;
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
  reinvestedMinor: number;
  byKind: Record<string, number>;
}

/** Investment income & tax per holding (gross, tax withheld, net, reinvested), largest first. */
export function incomeByHolding(lines: readonly IncomeLine[]): IncomeRow[] {
  const rows = new Map<string, IncomeRow>();
  for (const l of lines) {
    const r = rows.get(l.holdingId) ?? {
      holdingId: l.holdingId,
      holdingName: l.holdingName,
      grossMinor: 0,
      taxMinor: 0,
      netMinor: 0,
      reinvestedMinor: 0,
      byKind: {},
    };
    r.grossMinor += l.grossMinor;
    r.taxMinor += l.taxMinor;
    r.netMinor += l.grossMinor - l.taxMinor;
    if (l.reinvested) r.reinvestedMinor += l.grossMinor - l.taxMinor;
    r.byKind[l.incomeKind] = (r.byKind[l.incomeKind] ?? 0) + l.grossMinor;
    rows.set(l.holdingId, r);
  }
  return [...rows.values()].sort((a, b) => b.grossMinor - a.grossMinor);
}

// ------------------------------------------------------------------------------ monthly review

/** One category of a month's income or expense (top-level, largest first). */
export interface ReviewCategory {
  categoryId: string;
  name: string;
  amountMinor: number;
  previousMinor: number;
  changeBp: number | null;
  /** Share of the month's total for this side, in bp. */
  shareBp: number | null;
}

/** Category rows → review rows (children dropped; the summary lists top-level categories). */
export const reviewCategories = (rows: readonly CategoryRow[]): ReviewCategory[] =>
  rows.map((c) => ({
    categoryId: c.categoryId,
    name: c.name,
    amountMinor: c.amountMinor,
    previousMinor: c.previousMinor,
    changeBp: c.changeBp,
    shareBp: c.shareBp,
  }));

export interface MonthlyReview {
  month: string;
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
  savingsRateBp: number | null;
  previous: { incomeMinor: number; expenseMinor: number; savingsRateBp: number | null };
  incomeChangeBp: number | null;
  expenseChangeBp: number | null;
  /** Every expense category of the month, largest first (owner request: not only the top 5). */
  expenseCategories: ReviewCategory[];
  /** Every income category of the month, largest first; investment payouts are one row. */
  incomeCategories: ReviewCategory[];
  budgets: {
    categoryId: string;
    name: string;
    budgetMinor: number;
    spentMinor: number;
    status: "ok" | "warn" | "over";
  }[];
  netWorth: { startMinor: number; endMinor: number; changeMinor: number; changeBp: number | null };
  sips: { done: number; partial: number; missed: number; skipped: number; investedMinor: number };
  realizedGainMinor: number;
  feesMinor: number;
  insights: Insight[];
}

export function buildMonthlyReview(input: {
  month: string;
  currency: string;
  flows: { incomeMinor: number; expenseMinor: number };
  previousFlows: { incomeMinor: number; expenseMinor: number };
  categories: CategoryRow[];
  incomeCategories: CategoryRow[];
  budgets: MonthlyReview["budgets"];
  netWorthStartMinor: number;
  netWorthEndMinor: number;
  sips: MonthlyReview["sips"];
  realizedGainMinor: number;
  feesMinor: number;
  insights: readonly Insight[];
}): MonthlyReview {
  const rate = (f: { incomeMinor: number; expenseMinor: number }) =>
    f.incomeMinor > 0 ? divRound((f.incomeMinor - f.expenseMinor) * 10_000, f.incomeMinor) : null;
  return {
    month: input.month,
    currency: input.currency,
    incomeMinor: input.flows.incomeMinor,
    expenseMinor: input.flows.expenseMinor,
    savingsMinor: input.flows.incomeMinor - input.flows.expenseMinor,
    savingsRateBp: rate(input.flows),
    previous: { ...input.previousFlows, savingsRateBp: rate(input.previousFlows) },
    incomeChangeBp: changeBp(input.flows.incomeMinor, input.previousFlows.incomeMinor),
    expenseChangeBp: changeBp(input.flows.expenseMinor, input.previousFlows.expenseMinor),
    expenseCategories: reviewCategories(input.categories),
    incomeCategories: reviewCategories(input.incomeCategories),
    budgets: input.budgets,
    netWorth: {
      startMinor: input.netWorthStartMinor,
      endMinor: input.netWorthEndMinor,
      changeMinor: input.netWorthEndMinor - input.netWorthStartMinor,
      changeBp:
        input.netWorthStartMinor > 0
          ? divRound(
              (input.netWorthEndMinor - input.netWorthStartMinor) * 10_000,
              input.netWorthStartMinor,
            )
          : null,
    },
    sips: input.sips,
    realizedGainMinor: input.realizedGainMinor,
    feesMinor: input.feesMinor,
    insights: input.insights.slice(0, 3),
  };
}
