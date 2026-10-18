// Business periods in the user's timezone. Instants are stored in UTC; keys are computed from the
// wall-clock date in `tz`. Monthly key `YYYY-MM`, weekly key ISO week `YYYY-Www`.
import {
  addDays,
  addMonths,
  format,
  getISOWeek,
  getISOWeekYear,
  getISOWeeksInYear,
  setISOWeek,
  startOfISOWeek,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type PeriodFrequency = "monthly" | "weekly";

export interface PeriodRange {
  /** First instant of the period (inclusive), UTC. */
  start: Date;
  /** First instant after the period (exclusive), UTC. */
  end: Date;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK_KEY = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

function assertTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new RangeError(`unknown timezone ${tz}`);
  }
}

/** `date` viewed as wall-clock time in `tz` (local getters return the tz wall-clock fields). */
function wallClock(date: Date, tz: string): Date {
  assertTimezone(tz);
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid date");
  return toZonedTime(date, tz);
}

/** Local midnight of a wall-clock calendar date in `tz`, as a UTC instant. */
function localMidnight(year: number, monthIndex: number, day: number, tz: string): Date {
  const wall = format(new Date(year, monthIndex, day), "yyyy-MM-dd'T'00:00:00");
  return fromZonedTime(wall, tz);
}

/** Calendar date in `tz` as `YYYY-MM-DD`. */
export function localDateKey(date: Date, tz: string): string {
  return format(wallClock(date, tz), "yyyy-MM-dd");
}

/** Month in `tz` as `YYYY-MM`. */
export function monthKey(date: Date, tz: string): string {
  return format(wallClock(date, tz), "yyyy-MM");
}

/** ISO week in `tz` as `YYYY-Www` (ISO week-numbering year). */
export function weekKey(date: Date, tz: string): string {
  const wall = wallClock(date, tz);
  return `${getISOWeekYear(wall)}-W${String(getISOWeek(wall)).padStart(2, "0")}`;
}

export function periodKey(date: Date, tz: string, frequency: PeriodFrequency): string {
  return frequency === "monthly" ? monthKey(date, tz) : weekKey(date, tz);
}

function parseMonthKey(key: string): { year: number; monthIndex: number } {
  const m = MONTH_KEY.exec(key);
  if (!m) throw new RangeError(`invalid month key ${key}`);
  return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
}

/** UTC range covering the month `YYYY-MM` in `tz`. */
export function monthRange(key: string, tz: string): PeriodRange {
  assertTimezone(tz);
  const { year, monthIndex } = parseMonthKey(key);
  return {
    start: localMidnight(year, monthIndex, 1, tz),
    end: localMidnight(year, monthIndex + 1, 1, tz),
  };
}

/** UTC range covering the ISO week `YYYY-Www` in `tz` (Monday 00:00 to next Monday 00:00). */
export function weekRange(key: string, tz: string): PeriodRange {
  assertTimezone(tz);
  const m = WEEK_KEY.exec(key);
  if (!m) throw new RangeError(`invalid week key ${key}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // 4 January is always in ISO week 1 of its year.
  const jan4 = new Date(year, 0, 4);
  if (week > getISOWeeksInYear(jan4))
    throw new RangeError(`week ${week} does not exist in ${year}`);
  const monday = startOfISOWeek(setISOWeek(jan4, week));
  const next = addDays(monday, 7);
  return {
    start: localMidnight(monday.getFullYear(), monday.getMonth(), monday.getDate(), tz),
    end: localMidnight(next.getFullYear(), next.getMonth(), next.getDate(), tz),
  };
}

/** Shifts a `YYYY-MM` key by `months` (negative allowed). */
export function addMonthsToKey(key: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError("months must be an integer");
  const { year, monthIndex } = parseMonthKey(key);
  return format(addMonths(new Date(year, monthIndex, 1), months), "yyyy-MM");
}
