// docs/04 §24 — invested vs value over time (display only). Pure.
import { buildBuckets, prevDayKey, type Granularity, type KeyRange } from "@/domain/date-range";
import { daysBetween } from "@/domain/fd";
import {
  createHoldingReplayer,
  sortEvents,
  type HoldingEvent,
  type HoldingTxnEvent,
} from "@/domain/holdings";
import { roundHalfAwayFromZero } from "@/domain/money";

export interface InvestedValue {
  investedMinor: number;
  valueMinor: number;
}

interface Spread {
  /** Anchor day (exclusive). */
  from: string;
  /** Valuation day (exclusive: the §3 value is exact there). */
  to: string;
  moveMinor: number;
}

/**
 * Market moves made by valuations, each spread back to its anchor (§24.2): the previous
 * valuation, the first event, a full redemption, or a re-opening after one.
 */
function spreadsOf(sorted: readonly HoldingEvent[], trackUnits: boolean): Spread[] {
  const r = createHoldingReplayer({ trackUnits });
  const out: Spread[] = [];
  let anchor: string | null = null;
  let applied = false;
  for (const e of sorted) {
    const reopening = !applied || r.state.fullyRedeemed;
    if (e.kind === "valuation") {
      const before = r.state.currentValueMinor;
      r.apply(e);
      const move = r.state.currentValueMinor - before;
      const last = out.at(-1);
      if (last && last.to === e.date) last.moveMinor += move;
      else if (anchor !== null && anchor < e.date && move !== 0) {
        out.push({ from: anchor, to: e.date, moveMinor: move });
      }
      anchor = e.date;
    } else {
      r.apply(e);
      if (reopening || r.state.fullyRedeemed) anchor = e.date;
    }
    applied = true;
  }
  return out.filter((s) => s.moveMinor !== 0);
}

/**
 * One holding's invested and value at the end of each date in `dates` (ascending, unique),
 * in its own currency. FDs (`valueAt`) accrue daily per §9 and are never spread.
 */
export function holdingInvestedValues(
  events: readonly HoldingEvent[],
  opts: { trackUnits: boolean; valueAt?: (date: string) => number },
  dates: readonly string[],
): InvestedValue[] {
  const sorted = sortEvents(events);
  const spreads = opts.valueAt ? [] : spreadsOf(sorted, opts.trackUnits);
  const r = createHoldingReplayer({ trackUnits: opts.trackUnits, valueAt: opts.valueAt });
  let i = 0;
  let s = 0;
  return dates.map((d) => {
    while (i < sorted.length && sorted[i]!.date <= d) r.apply(sorted[i++]!);
    if (i === 0) return { investedMinor: 0, valueMinor: 0 };
    let value = r.valueOn(d);
    while (s < spreads.length && spreads[s]!.to <= d) s += 1;
    const sp = spreads[s];
    if (sp && sp.from < d && d < sp.to) {
      const share = daysBetween(sp.from, d) / daysBetween(sp.from, sp.to);
      value += roundHalfAwayFromZero(sp.moveMinor * share);
    }
    return { investedMinor: r.state.investedMinor, valueMinor: Math.max(0, value) };
  });
}

/** §24.4 — what a flow adds to the value on its day (native currency). */
function valueEffect(e: HoldingTxnEvent): number {
  switch (e.type) {
    case "invest":
      return e.amountMinor;
    case "redeem":
      return -e.amountMinor;
    case "investment_income":
      return e.reinvest ? e.amountMinor - (e.taxMinor ?? 0) : 0;
    case "opening_balance":
      return 0; // the whole first-day value counts instead (handled by the caller)
  }
}

export interface InvestmentSeriesHolding {
  id: string;
  currency: string;
  trackUnits: boolean;
  /** FDs: value on a date from the deposit terms (§9). */
  valueAt?: (date: string) => number;
}

export interface InvestmentSeriesInput {
  holdings: readonly InvestmentSeriesHolding[];
  holdingEvents: ReadonlyMap<string, readonly HoldingEvent[]>;
  /** Converts to base on a date; null = rate missing. */
  toBase: (amountMinor: number, currency: string, date: string) => number | null;
}

export interface InvestmentPoint extends InvestedValue {
  date: string;
  /** An included holding has a valuation on this day (a dot on the chart). */
  entered: boolean;
  /** Money moved in or out on this day: `before` is the end of the previous day. */
  before: InvestedValue | null;
}

export interface InvestmentSeries {
  points: InvestmentPoint[];
  /** End of the day before the range. */
  baseline: InvestedValue;
  end: InvestedValue & { gainMinor: number; gainBp: number | null };
  /** §24.4 — change in value not caused by money in or out. */
  marketGainMinor: number;
  /** §24.5 — dividends and interest dated in the range (gross). */
  incomeMinor: number;
  /** Holdings left out of the last point for a missing FX rate. */
  fxMissing: number;
}

/** A value of 0 recorded while nothing is held (a holding created empty) is not a value update. */
const isEmptyValuation = (e: HoldingEvent) => e.kind === "valuation" && e.valueMinor === 0;

/** First event date of the given holdings (the "All" range start), or null. */
export function firstEventDate(
  holdingEvents: ReadonlyMap<string, readonly HoldingEvent[]>,
  holdingIds: readonly string[],
): string | null {
  let first: string | null = null;
  for (const id of holdingIds) {
    for (const e of holdingEvents.get(id) ?? []) {
      if (!isEmptyValuation(e) && (!first || e.date < first)) first = e.date;
    }
  }
  return first;
}

/** §24 — invested vs value for the included holdings over `range`, in base. */
export function computeInvestmentSeries(
  input: InvestmentSeriesInput,
  range: KeyRange,
  granularity: Granularity,
): InvestmentSeries {
  const baselineDate = prevDayKey(range.from);
  const inRange = (d: string) => d >= range.from && d <= range.to;

  // §24.3 — bucket ends ∪ valuation days ∪ flow days; the day before each flow day for `before`.
  const pointDates = new Set(buildBuckets(range, granularity).map((b) => b.end));
  const flowDays = new Set<string>();
  for (const h of input.holdings) {
    for (const e of input.holdingEvents.get(h.id) ?? []) {
      if (!inRange(e.date) || isEmptyValuation(e)) continue;
      pointDates.add(e.date);
      if (e.kind === "txn") flowDays.add(e.date);
    }
  }
  const evalDates = new Set([baselineDate, ...pointDates]);
  for (const d of flowDays) evalDates.add(prevDayKey(d));
  const dates = [...evalDates].sort();
  const idx = new Map(dates.map((d, i) => [d, i]));

  const total = dates.map(() => ({ investedMinor: 0, valueMinor: 0, fxMissing: 0 }));
  const entered = new Set<string>();
  let marketFlows = 0;
  let incomeMinor = 0;
  for (const h of input.holdings) {
    const events = input.holdingEvents.get(h.id) ?? [];
    const values = holdingInvestedValues(events, h, dates);
    if (!h.valueAt) {
      for (const e of events) {
        if (e.kind === "valuation" && inRange(e.date) && !isEmptyValuation(e)) entered.add(e.date);
      }
    }
    values.forEach((v, i) => {
      if (v.investedMinor === 0 && v.valueMinor === 0) return;
      const d = dates[i]!;
      const value = input.toBase(v.valueMinor, h.currency, d);
      const invested = input.toBase(v.investedMinor, h.currency, d);
      if (value === null || invested === null) {
        total[i]!.fxMissing += 1;
        return;
      }
      total[i]!.valueMinor += value;
      total[i]!.investedMinor += invested;
    });

    // Money in or out per day of the range (base, on its date).
    const byDay = new Map<string, HoldingTxnEvent[]>();
    for (const e of events) {
      if (e.kind !== "txn" || !inRange(e.date)) continue;
      if (e.type === "investment_income") {
        incomeMinor += input.toBase(e.amountMinor, h.currency, e.date) ?? 0;
      }
      const list = byDay.get(e.date);
      if (list) list.push(e);
      else byDay.set(e.date, [e]);
    }
    for (const [d, list] of byDay) {
      let native: number;
      if (list.some((e) => e.type === "opening_balance")) {
        // An opening balance brings the whole position in: its first-day value is money in.
        native = values[idx.get(d)!]!.valueMinor - values[idx.get(prevDayKey(d))!]!.valueMinor;
      } else native = list.reduce((sum, e) => sum + valueEffect(e), 0);
      marketFlows += input.toBase(native, h.currency, d) ?? 0;
    }
  }

  const at = (d: string): InvestedValue => {
    const t = total[idx.get(d)!]!;
    return { investedMinor: t.investedMinor, valueMinor: t.valueMinor };
  };
  const points: InvestmentPoint[] = [...pointDates].sort().map((d) => ({
    date: d,
    ...at(d),
    entered: entered.has(d),
    before: flowDays.has(d) ? at(prevDayKey(d)) : null,
  }));
  const baseline = at(baselineDate);
  const last = at(range.to);
  const gainMinor = last.valueMinor - last.investedMinor;
  return {
    points,
    baseline,
    end: {
      ...last,
      gainMinor,
      gainBp:
        last.investedMinor > 0
          ? roundHalfAwayFromZero((gainMinor * 10_000) / last.investedMinor)
          : null,
    },
    marketGainMinor: last.valueMinor - baseline.valueMinor - marketFlows,
    incomeMinor,
    fxMissing: total[idx.get(range.to)!]!.fxMissing,
  };
}
