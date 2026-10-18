// Returns (docs/04 §5): XIRR from dated cash flows, simple return, CAGR.
import { mulDivRound } from "@/domain/money";
import { daysBetween } from "@/domain/fd";

export interface CashFlow {
  /** Business date `YYYY-MM-DD`. */
  date: string;
  /** Investor perspective: money in to the investment negative, money out positive. */
  amountMinor: number;
}

const TOLERANCE = 1e-7;
const MAX_ITERATIONS = 100;

/**
 * Annualised internal rate of return for irregular flows (fraction, 0.1 = 10%).
 * Newton–Raphson from 0.1, falling back to bisection on [−0.9999, 10]. Returns null when flows
 * lack a sign change or span fewer than `minSpanDays` (default 90) days.
 */
export function xirr(
  flows: readonly CashFlow[],
  opts: { minSpanDays?: number } = {},
): number | null {
  const nonZero = flows.filter((f) => f.amountMinor !== 0);
  if (nonZero.length < 2) return null;
  if (!nonZero.some((f) => f.amountMinor > 0) || !nonZero.some((f) => f.amountMinor < 0))
    return null;
  const first = nonZero.reduce((min, f) => (f.date < min ? f.date : min), nonZero[0]!.date);
  const last = nonZero.reduce((max, f) => (f.date > max ? f.date : max), nonZero[0]!.date);
  if (daysBetween(first, last) < (opts.minSpanDays ?? 90)) return null;

  const t = nonZero.map((f) => ({
    years: daysBetween(first, f.date) / 365,
    amount: f.amountMinor,
  }));
  const npv = (r: number) => t.reduce((s, f) => s + f.amount / (1 + r) ** f.years, 0);
  const dnpv = (r: number) =>
    t.reduce((s, f) => s - (f.years * f.amount) / (1 + r) ** (f.years + 1), 0);
  const scale = Math.max(...t.map((f) => Math.abs(f.amount)));

  let r = 0.1;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < TOLERANCE) return Math.abs(npv(next)) / scale < 1e-6 ? next : null;
    r = next;
  }

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi))
    return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(hi - lo) < TOLERANCE || fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** XIRR in basis points (rounded), or null. */
export function xirrBp(flows: readonly CashFlow[], opts?: { minSpanDays?: number }): number | null {
  const r = xirr(flows, opts);
  return r === null ? null : Math.round(r * 10_000);
}

/** gain ÷ invested in bp; null when nothing is invested. */
export function simpleReturnBp(gainMinor: number, investedMinor: number): number | null {
  return investedMinor > 0 ? mulDivRound(gainMinor, 10_000, investedMinor) : null;
}

/** Compound annual growth from start to end value over `days`; null for < 1 day or start ≤ 0. */
export function cagrBp(startMinor: number, endMinor: number, days: number): number | null {
  if (startMinor <= 0 || days < 1 || endMinor < 0) return null;
  return Math.round(((endMinor / startMinor) ** (365 / days) - 1) * 10_000);
}
