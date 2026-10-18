// Business dates (`YYYY-MM-DD` in the user's timezone) ↔ stored UTC instants.
import { fromZonedTime } from "date-fns-tz";
import { localDateKey } from "@/domain/periods";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: string): boolean {
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

/** A business date is stored as local midnight in `tz` (a UTC instant). */
export function businessDateToUtc(dateKey: string, tz: string): Date {
  if (!isDateKey(dateKey)) throw new RangeError(`invalid date ${dateKey}`);
  return fromZonedTime(`${dateKey}T00:00:00`, tz);
}

/** The business date (`YYYY-MM-DD` in `tz`) of a stored instant. */
export function utcToBusinessDate(date: Date, tz: string): string {
  return localDateKey(date, tz);
}
