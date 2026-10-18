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
