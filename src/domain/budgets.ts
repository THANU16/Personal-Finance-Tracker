// Budgets (docs/04 §13). Pure. Money in minor units, shares in bp.

/** One categorised expense line (a split line, an expense, a transfer fee or loan interest). */
export interface SpendLine {
  categoryId: string;
  amountMinor: number;
}

export interface BudgetLine {
  categoryId: string;
  amountMinor: number;
}

export type BudgetStatus = "ok" | "warn" | "over";

/** ok < 80% ≤ warn < 100% ≤ over (alerts at 80% and 100%). */
export function budgetStatus(
  spentMinor: number,
  budgetMinor: number,
): { usedBp: number; status: BudgetStatus } {
  const usedBp =
    budgetMinor > 0 ? Math.round((spentMinor * 10_000) / budgetMinor) : spentMinor > 0 ? 10_000 : 0;
  // Status from exact amounts: 999,999 of 1,000,000 rounds to 100.0% but is not over yet.
  const over = budgetMinor > 0 ? spentMinor >= budgetMinor : spentMinor > 0;
  const warn = budgetMinor > 0 && spentMinor * 10 >= budgetMinor * 8;
  return { usedBp, status: over ? "over" : warn ? "warn" : "ok" };
}

/** Spending per category, own lines only. */
export function spendByCategory(lines: readonly SpendLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) out.set(l.categoryId, (out.get(l.categoryId) ?? 0) + l.amountMinor);
  return out;
}

/**
 * Actual per budget (docs/04 §13): expense in the category and its children (2-level tree),
 * splits counted per line. `parentOf` maps child → parent category id.
 */
export function budgetActuals(
  lines: readonly SpendLine[],
  parentOf: ReadonlyMap<string, string | null>,
  budgets: readonly BudgetLine[],
): Map<string, number> {
  const own = spendByCategory(lines);
  const out = new Map<string, number>();
  for (const b of budgets) {
    let total = own.get(b.categoryId) ?? 0;
    for (const [cat, amount] of own) if (parentOf.get(cat) === b.categoryId) total += amount;
    out.set(b.categoryId, total);
  }
  return out;
}

/** Lines not covered by any budget (neither their category nor its parent is budgeted). */
export function unbudgeted(
  lines: readonly SpendLine[],
  parentOf: ReadonlyMap<string, string | null>,
  budgetedIds: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const parent = parentOf.get(l.categoryId) ?? null;
    if (budgetedIds.has(l.categoryId) || (parent && budgetedIds.has(parent))) continue;
    out.set(l.categoryId, (out.get(l.categoryId) ?? 0) + l.amountMinor);
  }
  return out;
}

/**
 * Total spent against budgets, each line counted once (a child under a budgeted parent counts in
 * both rows but only once here).
 */
export function budgetedSpendTotal(
  lines: readonly SpendLine[],
  parentOf: ReadonlyMap<string, string | null>,
  budgetedIds: ReadonlySet<string>,
): number {
  return lines.reduce((s, l) => {
    const parent = parentOf.get(l.categoryId) ?? null;
    return budgetedIds.has(l.categoryId) || (parent && budgetedIds.has(parent))
      ? s + l.amountMinor
      : s;
  }, 0);
}

/** Total budgeted, counting only budgets whose parent has no budget of its own. */
export function budgetTotal(
  budgets: readonly BudgetLine[],
  parentOf: ReadonlyMap<string, string | null>,
): number {
  const ids = new Set(budgets.map((b) => b.categoryId));
  return budgets.reduce((s, b) => {
    const parent = parentOf.get(b.categoryId) ?? null;
    return parent && ids.has(parent) ? s : s + b.amountMinor;
  }, 0);
}

/** Copy forward: last month's budgets for categories that have none this month. */
export function copyForward(
  previous: readonly BudgetLine[],
  current: readonly BudgetLine[],
): BudgetLine[] {
  const have = new Set(current.map((b) => b.categoryId));
  return previous.filter((b) => !have.has(b.categoryId)).map((b) => ({ ...b }));
}

/** `YYYY-MM` of the month before. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------ repeating budgets
// Owner request: a budget can repeat every month from a start month (optionally until an end month)
// instead of being set month by month. A one-month row overrides it for that month (or skips it).

/** A month's own budget row; `skip` = no budget this month even though one repeats. */
export interface MonthBudget {
  categoryId: string;
  amountMinor: number;
  skip: boolean;
}

/** A repeating budget: every month from `fromMonth` to `untilMonth` (null = no end). */
export interface BudgetRule {
  categoryId: string;
  amountMinor: number;
  fromMonth: string;
  untilMonth: string | null;
}

export interface EffectiveBudget extends BudgetLine {
  /** The repeating budget in force, or null for a one-month budget. */
  repeat: { fromMonth: string; untilMonth: string | null } | null;
}

/** Does the rule cover `month`? (`YYYY-MM` keys compare as strings.) */
export function ruleCovers(rule: Pick<BudgetRule, "fromMonth" | "untilMonth">, month: string) {
  return rule.fromMonth <= month && (rule.untilMonth === null || rule.untilMonth >= month);
}

/**
 * The budget that applies to each category in `month`: its own row wins (a skip row means none);
 * otherwise the covering repeating budget with the latest start month. Sorted by category id.
 */
export function effectiveBudgets(
  month: string,
  monthRows: readonly MonthBudget[],
  rules: readonly BudgetRule[],
): EffectiveBudget[] {
  const out = new Map<string, EffectiveBudget>();
  const own = new Map(monthRows.map((r) => [r.categoryId, r]));
  for (const r of rules) {
    if (!ruleCovers(r, month) || own.has(r.categoryId)) continue;
    const cur = out.get(r.categoryId);
    if (cur?.repeat && cur.repeat.fromMonth >= r.fromMonth) continue;
    out.set(r.categoryId, {
      categoryId: r.categoryId,
      amountMinor: r.amountMinor,
      repeat: { fromMonth: r.fromMonth, untilMonth: r.untilMonth },
    });
  }
  for (const r of monthRows) {
    if (r.skip) continue;
    out.set(r.categoryId, { categoryId: r.categoryId, amountMinor: r.amountMinor, repeat: null });
  }
  return [...out.values()].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1));
}
