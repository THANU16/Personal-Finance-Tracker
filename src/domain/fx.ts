// docs/04 §14 — currency conversion. Pure: rates in, integer minor units out. Never assumes 1:1.
import { minorUnitDigits, roundHalfAwayFromZero } from "@/domain/money";

export interface FxRateLike {
  /** Business date key YYYY-MM-DD. */
  date: string;
  base: string;
  quote: string;
  /** Quote units per 1 base unit (major units), e.g. USD/LKR 300.5. */
  rate: number;
}

interface DatedRate {
  date: string;
  rate: number;
}

/** Rates indexed by pair, each list sorted by date ascending. */
export interface FxTable {
  pairs: Map<string, DatedRate[]>;
}

const pairKey = (base: string, quote: string) => `${base}/${quote}`;

export function buildFxTable(rates: readonly FxRateLike[]): FxTable {
  const pairs = new Map<string, DatedRate[]>();
  for (const r of rates) {
    if (!(r.rate > 0) || !Number.isFinite(r.rate)) continue;
    const key = pairKey(r.base, r.quote);
    const list = pairs.get(key) ?? [];
    list.push({ date: r.date, rate: r.rate });
    pairs.set(key, list);
  }
  for (const list of pairs.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return { pairs };
}

/** Latest entry on or before `date` (binary search), else null. */
function latestOnOrBefore(list: readonly DatedRate[] | undefined, date: string): DatedRate | null {
  if (!list || list.length === 0) return null;
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? list[found]! : null;
}

/**
 * Rate to convert `from` → `to` on `date`: latest direct rate on or before the date, else the
 * inverse of the latest opposite rate; 1 for the same currency; null when no rate exists.
 */
export function rateOn(table: FxTable, from: string, to: string, date: string): number | null {
  if (from === to) return 1;
  const direct = latestOnOrBefore(table.pairs.get(pairKey(from, to)), date);
  if (direct) return direct.rate;
  const inverse = latestOnOrBefore(table.pairs.get(pairKey(to, from)), date);
  if (inverse) return 1 / inverse.rate;
  return null;
}

/** Converts minor units between currencies (respecting each one's minor digits), rounding half away from zero. */
export function convertMinor(amountMinor: number, from: string, to: string, rate: number): number {
  if (from === to) return amountMinor;
  const shift = minorUnitDigits(to) - minorUnitDigits(from);
  const result = roundHalfAwayFromZero(amountMinor * rate * 10 ** shift);
  if (!Number.isSafeInteger(result)) throw new RangeError("Converted amount is out of range");
  return result === 0 ? 0 : result;
}

/** Converter to one target currency; returns null when the rate is missing (callers exclude + badge). */
export function makeConverter(table: FxTable, target: string) {
  return (amountMinor: number, currency: string, date: string): number | null => {
    if (currency === target) return amountMinor;
    const rate = rateOn(table, currency, target, date);
    return rate === null ? null : convertMinor(amountMinor, currency, target, rate);
  };
}

export type ToBase = ReturnType<typeof makeConverter>;
