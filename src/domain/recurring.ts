// Recurring rules (docs/04 §11). Pure: business date keys `YYYY-MM-DD` only.

export const FREQUENCIES = ["monthly", "weekly", "yearly", "every_n_months"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface Schedule {
  frequency: Frequency;
  /** Weeks for weekly, months for every_n_months (≥ 1); monthly/yearly use 1. */
  interval: number;
  /** monthly / yearly / every_n_months: 1–31, clamped to the month's last day. */
  dayOfMonth?: number | null;
  /** weekly: 0 = Sunday … 6 = Saturday. */
  weekday?: number | null;
  /** yearly: 1–12. */
  monthOfYear?: number | null;
  startDate: string;
  endDate?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const parts = (key: string) => key.split("-").map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const toUtc = (key: string) => {
  const [y, m, d] = parts(key);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (t: number) => {
  const d = new Date(t);
  return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};
export const addDays = (key: string, days: number) => fromUtc(toUtc(key) + days * 86_400_000);

/** Date in month `index` (0 = Jan of year 0) on `day`, clamped to month end. */
function onDay(monthIndex: number, day: number): string {
  const y = Math.floor(monthIndex / 12);
  const m = (monthIndex % 12) + 1;
  return keyOf(y, m, Math.min(day, daysIn(y, m)));
}

function stepMonths(s: Schedule): number {
  if (s.frequency === "yearly") return 12;
  if (s.frequency === "every_n_months") return Math.max(1, s.interval);
  return 1;
}

/** First occurrence on or after the start date. */
export function firstDue(s: Schedule): string | null {
  const [y, m, d] = parts(s.startDate);
  let due: string;
  if (s.frequency === "weekly") {
    const weekday = s.weekday ?? new Date(toUtc(s.startDate)).getUTCDay();
    const offset = (weekday - new Date(toUtc(s.startDate)).getUTCDay() + 7) % 7;
    due = addDays(s.startDate, offset);
  } else {
    const day = s.dayOfMonth ?? d;
    let index = y * 12 + (m - 1);
    if (s.frequency === "yearly") {
      const month = (s.monthOfYear ?? m) - 1;
      index = y * 12 + month;
      if (onDay(index, day) < s.startDate) index += 12;
    } else if (onDay(index, day) < s.startDate) {
      index += 1;
    }
    due = onDay(index, day);
  }
  return s.endDate && due > s.endDate ? null : due;
}

/** The occurrence after `due` (monthly days re-anchor to dayOfMonth: 31 Jan → 28 Feb → 31 Mar). */
export function nextAfter(s: Schedule, due: string): string | null {
  let next: string;
  if (s.frequency === "weekly") {
    next = addDays(due, 7 * Math.max(1, s.interval));
  } else {
    const [y, m, d] = parts(due);
    const day = s.dayOfMonth ?? (s.frequency === "yearly" ? parts(s.startDate)[2] : d);
    next = onDay(y * 12 + (m - 1) + stepMonths(s), day);
  }
  return s.endDate && next > s.endDate ? null : next;
}

/** All occurrences from `from` (a due date) up to `until`, inclusive (at most `max`). */
export function occurrences(s: Schedule, from: string, until: string, max = 60): string[] {
  const out: string[] = [];
  let due: string | null = from;
  while (due && due <= until && out.length < max) {
    out.push(due);
    due = nextAfter(s, due);
  }
  return out;
}

export function reminderDate(due: string, reminderDaysBefore: number): string {
  return addDays(due, -Math.max(0, reminderDaysBefore));
}
