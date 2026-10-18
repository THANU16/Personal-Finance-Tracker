// Date-range presets for filters, as inclusive business-date keys (`YYYY-MM-DD`, user timezone).
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  parse,
  startOfWeek,
} from "date-fns";

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

// ---------------------------------------------------------------------------------------------
// docs/04 §22 — analytics time ranges: presets, granularity, buckets, compare period.

export const RANGE_PRESETS = [
  "today",
  "7d",
  "30d",
  "3m",
  "6m",
  "ytd",
  "1y",
  "all",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const MAX_BUCKETS_WARNING = 400;

/** Inclusive, bounded range of business-date keys. */
export interface KeyRange {
  from: string;
  to: string;
}

/** One bucket of a series: inclusive first/last day (clipped to the range). */
export interface Bucket {
  /** Stable id: the day, the Monday of the week, or `YYYY-MM`. */
  key: string;
  start: string;
  end: string;
}

const isKey = (v: string | null | undefined): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = toDate(v);
  return !Number.isNaN(d.getTime()) && toKey(d) === v;
};

/** Days in an inclusive range. */
export function rangeDays(range: KeyRange): number {
  return differenceInCalendarDays(toDate(range.to), toDate(range.from)) + 1;
}

/**
 * Resolves an analytics preset to an inclusive range ending today. "All" starts at `earliestKey`
 * (first data date; today when there is none). Custom ranges are swapped if reversed and fall
 * back to 30 days when incomplete.
 */
export function resolveRange(
  preset: RangePreset,
  todayKey: string,
  opts: { from?: string | null; to?: string | null; earliestKey?: string | null } = {},
): KeyRange {
  const today = toDate(todayKey);
  const back = (days: number) => toKey(addDays(today, -(days - 1)));
  switch (preset) {
    case "today":
      return { from: todayKey, to: todayKey };
    case "7d":
      return { from: back(7), to: todayKey };
    case "30d":
      return { from: back(30), to: todayKey };
    case "3m":
      return { from: toKey(addDays(addMonths(today, -3), 1)), to: todayKey };
    case "6m":
      return { from: toKey(addDays(addMonths(today, -6), 1)), to: todayKey };
    case "ytd":
      return { from: `${today.getFullYear()}-01-01`, to: todayKey };
    case "1y":
      return { from: toKey(addDays(addMonths(today, -12), 1)), to: todayKey };
    case "all": {
      const earliest = isKey(opts.earliestKey) ? opts.earliestKey : todayKey;
      return { from: earliest <= todayKey ? earliest : todayKey, to: todayKey };
    }
    case "custom": {
      if (!isKey(opts.from) || !isKey(opts.to)) return { from: back(30), to: todayKey };
      return opts.from <= opts.to
        ? { from: opts.from, to: opts.to }
        : { from: opts.to, to: opts.from };
    }
  }
}

/** ≤ 31 days → day, ≤ 183 → week, else month. */
export function defaultGranularity(range: KeyRange): Granularity {
  const days = rangeDays(range);
  if (days <= 31) return "day";
  if (days <= 183) return "week";
  return "month";
}

/** The bucket key a day belongs to (Monday-start weeks). */
export function bucketKeyOf(dayKey: string, g: Granularity): string {
  if (g === "day") return dayKey;
  const d = toDate(dayKey);
  if (g === "week") return toKey(startOfWeek(d, { weekStartsOn: 1 }));
  return dayKey.slice(0, 7);
}

/** Every bucket covering the range, in order, clipped to it (gap-free by construction). */
export function buildBuckets(range: KeyRange, g: Granularity): Bucket[] {
  const out: Bucket[] = [];
  let cursor = toDate(range.from);
  const last = toDate(range.to);
  while (cursor <= last) {
    let periodEnd: Date;
    if (g === "day") periodEnd = cursor;
    else if (g === "week") periodEnd = endOfWeek(cursor, { weekStartsOn: 1 });
    else periodEnd = endOfMonth(cursor);
    const end = periodEnd > last ? last : periodEnd;
    const start = toKey(cursor);
    out.push({ key: bucketKeyOf(start, g), start, end: toKey(end) });
    cursor = addDays(end, 1);
  }
  return out;
}

/** Number of buckets without building them (for the > 400 warning). */
export function bucketCount(range: KeyRange, g: Granularity): number {
  const from = toDate(range.from);
  const to = toDate(range.to);
  if (g === "day") return rangeDays(range);
  if (g === "week") {
    return (
      differenceInCalendarDays(
        startOfWeek(to, { weekStartsOn: 1 }),
        startOfWeek(from, { weekStartsOn: 1 }),
      ) /
        7 +
      1
    );
  }
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
}

/** The equal-length period immediately before the range. */
export function previousPeriod(range: KeyRange): KeyRange {
  const days = rangeDays(range);
  const to = addDays(toDate(range.from), -1);
  return { from: toKey(addDays(to, -(days - 1))), to: toKey(to) };
}

/** Parsed `?r=&from=&to=&g=&cmp=` view state (TimeRangeBar ↔ server components). */
export interface RangeView {
  preset: RangePreset;
  range: KeyRange;
  granularity: Granularity;
  /** The user picked the granularity (otherwise it follows the range length). */
  granularityPinned: boolean;
  compare: boolean;
  bucketCount: number;
  tooManyBuckets: boolean;
}

export const DEFAULT_PRESET: RangePreset = "6m";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseRangeView(
  params: Record<string, string | string[] | undefined>,
  todayKey: string,
  earliestKey?: string | null,
): RangeView {
  const r = first(params.r);
  const from = first(params.from);
  const to = first(params.to);
  const preset: RangePreset = (RANGE_PRESETS as readonly string[]).includes(r ?? "")
    ? (r as RangePreset)
    : isKey(from) && isKey(to)
      ? "custom"
      : DEFAULT_PRESET;
  const range = resolveRange(preset, todayKey, { from, to, earliestKey });
  const g = first(params.g);
  const pinned = (GRANULARITIES as readonly string[]).includes(g ?? "");
  const granularity = pinned ? (g as Granularity) : defaultGranularity(range);
  const count = bucketCount(range, granularity);
  return {
    preset,
    range,
    granularity,
    granularityPinned: pinned,
    compare: first(params.cmp) === "1",
    bucketCount: count,
    tooManyBuckets: count > MAX_BUCKETS_WARNING,
  };
}
