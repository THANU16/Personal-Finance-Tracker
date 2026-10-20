// Fixed deposits (docs/04 §9). Dates are business-date keys (YYYY-MM-DD).
import { roundHalfAwayFromZero } from "@/domain/money";

export const FD_COMPOUNDING = ["simple", "monthly", "quarterly", "annually"] as const;
export type FdCompounding = (typeof FD_COMPOUNDING)[number];
export const FD_PAYOUTS = ["at_maturity", "monthly", "quarterly"] as const;
export type FdPayout = (typeof FD_PAYOUTS)[number];

export interface FdTerms {
  principalMinor: number;
  rateBp: number;
  startDate: string;
  maturityDate: string;
  compounding: FdCompounding;
  payout: FdPayout;
}

const PERIODS: Record<Exclude<FdCompounding, "simple">, number> = {
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

function utcDay(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`invalid date ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return utcDay(to) - utcDay(from);
}

function check(t: FdTerms) {
  if (!Number.isSafeInteger(t.principalMinor) || t.principalMinor <= 0)
    throw new RangeError("principal must be > 0");
  if (!Number.isSafeInteger(t.rateBp) || t.rateBp < 0) throw new RangeError("rate must be ≥ 0");
  if (daysBetween(t.startDate, t.maturityDate) <= 0)
    throw new RangeError("maturity must be after start");
}

/**
 * Value on `asOf` (capped at maturity): simple `P × (1 + r × years)` or compounded
 * `P × (1 + r/m)^(m × years)`, years = days / 365. Payout FDs stay at principal (interest is paid out).
 */
export function fdValue(t: FdTerms, asOf: string): number {
  check(t);
  if (t.payout !== "at_maturity") return t.principalMinor;
  const end = daysBetween(asOf, t.maturityDate) < 0 ? t.maturityDate : asOf;
  const days = Math.max(0, daysBetween(t.startDate, end));
  const years = days / 365;
  const r = t.rateBp / 10_000;
  const factor =
    t.compounding === "simple"
      ? 1 + r * years
      : (1 + r / PERIODS[t.compounding]) ** (PERIODS[t.compounding] * years);
  return roundHalfAwayFromZero(t.principalMinor * factor);
}

export function fdMaturityValue(t: FdTerms): number {
  return fdValue(t, t.maturityDate);
}

/** Interest accrued so far (value − principal). */
export function fdAccruedInterest(t: FdTerms, asOf: string): number {
  return fdValue(t, asOf) - t.principalMinor;
}

/** Interest paid each period for payout FDs: round(P × r / periodsPerYear). */
export function fdPayoutPerPeriod(t: FdTerms): number | null {
  check(t);
  if (t.payout === "at_maturity") return null;
  const perYear = t.payout === "monthly" ? 12 : 4;
  return roundHalfAwayFromZero((t.principalMinor * t.rateBp) / 10_000 / perYear);
}

export function daysToMaturity(t: Pick<FdTerms, "maturityDate">, today: string): number {
  return daysBetween(today, t.maturityDate);
}

/**
 * Latest interest date of a payout FD on or before `today` (start + k × 1 or 3 months, day clamped
 * to month end; the last one is the maturity date). null before the first payout or for at-maturity FDs.
 */
export function lastPayoutDate(t: FdTerms, today: string): string | null {
  if (t.payout === "at_maturity") return null;
  const step = t.payout === "monthly" ? 1 : 3;
  const [y, m, d] = t.startDate.split("-").map(Number) as [number, number, number];
  const end = today < t.maturityDate ? today : t.maturityDate;
  let last: string | null = null;
  for (let k = 1; k < 1200; k++) {
    const idx = y * 12 + (m - 1) + k * step;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    const dd = Math.min(d, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
    let key = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (key > t.maturityDate) key = t.maturityDate;
    if (key > end) break;
    last = key;
    if (key === t.maturityDate) break;
  }
  return last;
}
