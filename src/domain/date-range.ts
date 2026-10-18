// Date-range presets for filters, as inclusive business-date keys (`YYYY-MM-DD`, user timezone).
import { addDays, format, parse } from "date-fns";

export const DATE_RANGE_PRESETS = [
  "this_month",
  "last_month",
  "last_30",
  "last_90",
  "this_year",
  "all",
  "custom",
] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export interface DateKeyRange {
  /** Inclusive first day; null = unbounded. */
  from: string | null;
  /** Inclusive last day; null = unbounded. */
  to: string | null;
}

const KEY = "yyyy-MM-dd";
const toDate = (key: string) => parse(key, KEY, new Date(2000, 0, 1));
const toKey = (d: Date) => format(d, KEY);

/** Resolves a preset relative to `todayKey`; `custom` uses from/to (swapped if reversed). */
export function resolveDateRange(
  preset: DateRangePreset,
  todayKey: string,
  custom: { from?: string | null; to?: string | null } = {},
): DateKeyRange {
  const today = toDate(todayKey);
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "this_month":
      return { from: toKey(new Date(y, m, 1)), to: toKey(new Date(y, m + 1, 0)) };
    case "last_month":
      return { from: toKey(new Date(y, m - 1, 1)), to: toKey(new Date(y, m, 0)) };
    case "last_30":
      return { from: toKey(addDays(today, -29)), to: todayKey };
    case "last_90":
      return { from: toKey(addDays(today, -89)), to: todayKey };
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "all":
      return { from: null, to: null };
    case "custom": {
      const from = custom.from ?? null;
      const to = custom.to ?? null;
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
  }
}

/** The day after a key (for exclusive upper bounds). */
export function nextDayKey(key: string): string {
  return toKey(addDays(toDate(key), 1));
}
