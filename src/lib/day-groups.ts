// Activity list on phones (docs/07 §5): rows grouped by day with a day total. Display only — it
// sums values the page already shows; the caller decides what counts (owner decision, M4).

export interface DayGroup<T> {
  /** `YYYY-MM-DD` */
  day: string;
  rows: T[];
  /** Sum of the counted rows (integer minor units). */
  totalMinor: number;
  /** True when some rows could not be counted (e.g. another currency). */
  partial: boolean;
}

/**
 * Groups rows by day, keeping their order (the ledger is already sorted). `signed` returns the
 * row's contribution in minor units, 0 for rows that do not count (transfers, voids), or null for
 * rows that should count but cannot be added (another currency) — those mark the day partial.
 */
export function groupByDay<T>(
  rows: readonly T[],
  dayOf: (row: T) => string,
  signed: (row: T) => number | null,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byDay = new Map<string, DayGroup<T>>();
  for (const row of rows) {
    const day = dayOf(row);
    let g = byDay.get(day);
    if (!g) {
      g = { day, rows: [], totalMinor: 0, partial: false };
      byDay.set(day, g);
      groups.push(g);
    }
    g.rows.push(row);
    const v = signed(row);
    if (v === null) g.partial = true;
    else g.totalMinor += v;
  }
  return groups;
}

/** Cashflow sign of a ledger row for a day total: income +, expense −, everything else 0. */
export function cashflowSigned(
  t: { type: string; status: string; amountMinor: number; currency: string },
  baseCurrency: string,
): number | null {
  if (t.status === "void") return 0;
  if (t.type !== "income" && t.type !== "expense") return 0;
  if (t.currency !== baseCurrency) return null;
  return t.type === "income" ? t.amountMinor : -t.amountMinor;
}
