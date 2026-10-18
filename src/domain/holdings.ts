// Holding caches by replaying its ledger (docs/04 §3, §5, §12). Pure.
import { add, sub } from "@/domain/money";
import { daysBetween } from "@/domain/fd";
import {
  redeemByAmount,
  redeemByUnits,
  roundUnits,
  unitsValueMinor,
  type RedemptionResult,
} from "@/domain/redemption";
import type { CashFlow } from "@/domain/returns";

export type HoldingTxnType = "opening_balance" | "invest" | "redeem" | "investment_income";

export interface HoldingTxnEvent {
  kind: "txn";
  id: string;
  type: HoldingTxnType;
  /** Business date `YYYY-MM-DD`. */
  date: string;
  /** Tie-breaker within a date (creation order). */
  seq: number;
  amountMinor: number;
  feeMinor?: number;
  taxMinor?: number;
  units?: number | null;
  priceMinorE4?: number | null;
  reinvest?: boolean | null;
}

export interface ValuationEvent {
  kind: "valuation";
  id: string;
  date: string;
  seq: number;
  valueMinor: number;
  priceMinorE4?: number | null;
  units?: number | null;
}

export type HoldingEvent = HoldingTxnEvent | ValuationEvent;

export interface HoldingState {
  investedMinor: number;
  currentValueMinor: number;
  units: number | null;
  avgCostMinor: number | null;
  realizedGainMinor: number;
  incomeReceivedMinor: number;
  feesPaidMinor: number;
  taxWithheldMinor: number;
  firstInvestedAt: string | null;
  lastValuedAt: string | null;
  lastPriceMinorE4: number | null;
  /** The last redemption sold everything. */
  fullyRedeemed: boolean;
}

export interface ReplayResult {
  state: HoldingState;
  /** Recomputed redemption figures per redeem transaction id. */
  redemptions: Map<string, RedemptionResult>;
  /** Invested and value at the end of each date with activity (for charts). */
  timeline: { date: string; investedMinor: number; valueMinor: number }[];
}

export interface ReplayOptions {
  trackUnits: boolean;
  /** FD holdings: value on a date comes from the deposit terms (§9), not valuations. */
  valueAt?: (date: string) => number;
  /** Stop after this date (inclusive), e.g. to get the state as of a redemption date. */
  until?: string;
}

/**
 * Date order; within a date, the order events were entered (owner decision, Phase 3): a valuation
 * covers same-day activity entered before it, and later same-day activity adjusts it.
 */
export function sortEvents<T extends HoldingEvent>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
}

const emptyState = (): HoldingState => ({
  investedMinor: 0,
  currentValueMinor: 0,
  units: null,
  avgCostMinor: null,
  realizedGainMinor: 0,
  incomeReceivedMinor: 0,
  feesPaidMinor: 0,
  taxWithheldMinor: 0,
  firstInvestedAt: null,
  lastValuedAt: null,
  lastPriceMinorE4: null,
  fullyRedeemed: false,
});

/**
 * Processes posted transactions and valuations in order (docs/04 §3):
 * opening_balance → invested += amount; invest → invested += amount+fee, value += amount;
 * redeem → invested −= costRemoved, value −= amount; income reinvested → both += amount−tax.
 * A valuation sets the value; later flows adjust it. Tracked units with a known price:
 * value = units × lastPrice.
 */
export function replayHolding(events: readonly HoldingEvent[], opts: ReplayOptions): ReplayResult {
  const s = emptyState();
  const redemptions = new Map<string, RedemptionResult>();
  const timeline: ReplayResult["timeline"] = [];
  const addUnits = (u: number | null | undefined) => {
    if (u === null || u === undefined) return;
    s.units = roundUnits((s.units ?? 0) + u);
  };
  const priceValue = () => {
    if (opts.trackUnits && s.lastPriceMinorE4 !== null && s.units !== null && !opts.valueAt) {
      s.currentValueMinor = unitsValueMinor(s.units, s.lastPriceMinorE4);
    }
  };

  const sorted = sortEvents(events).filter((e) => !opts.until || e.date <= opts.until);
  for (const e of sorted) {
    if (opts.valueAt && !s.fullyRedeemed) s.currentValueMinor = opts.valueAt(e.date);

    if (e.kind === "valuation") {
      if (!opts.valueAt) s.currentValueMinor = e.valueMinor;
      s.lastValuedAt = e.date;
      if (e.units !== null && e.units !== undefined) s.units = roundUnits(e.units);
      if (e.priceMinorE4) s.lastPriceMinorE4 = e.priceMinorE4;
      if (opts.trackUnits && e.priceMinorE4 && s.units !== null && !opts.valueAt) {
        s.currentValueMinor = unitsValueMinor(s.units, e.priceMinorE4);
      }
    } else {
      const fee = e.feeMinor ?? 0;
      const tax = e.taxMinor ?? 0;
      switch (e.type) {
        case "opening_balance":
          s.investedMinor = add(s.investedMinor, e.amountMinor);
          s.firstInvestedAt ??= e.date;
          addUnits(e.units);
          if (e.priceMinorE4) s.lastPriceMinorE4 = e.priceMinorE4;
          s.fullyRedeemed = false;
          break;
        case "invest":
          s.investedMinor = add(s.investedMinor, e.amountMinor, fee);
          if (!opts.valueAt) s.currentValueMinor = add(s.currentValueMinor, e.amountMinor);
          s.feesPaidMinor = add(s.feesPaidMinor, fee);
          s.firstInvestedAt ??= e.date;
          addUnits(e.units);
          if (e.priceMinorE4) s.lastPriceMinorE4 = e.priceMinorE4;
          s.fullyRedeemed = false;
          priceValue();
          break;
        case "redeem": {
          const byUnits =
            opts.trackUnits && e.units && e.priceMinorE4 && s.units !== null && s.units > 0;
          const r = byUnits
            ? redeemByUnits({
                investedMinor: s.investedMinor,
                currentValueMinor: s.currentValueMinor,
                unitsHeld: s.units!,
                unitsSold: Math.min(e.units!, s.units!),
                priceMinorE4: e.priceMinorE4!,
                feeMinor: fee,
                taxMinor: tax,
              })
            : redeemByAmount({
                investedMinor: s.investedMinor,
                // FD withdrawals are always the whole deposit (amount = what the bank paid), and replay
                // must not throw on stored history: a zero recorded value means a full redemption too.
                currentValueMinor: opts.valueAt ? e.amountMinor : Math.max(s.currentValueMinor, 1),
                amountMinor: e.amountMinor,
                feeMinor: fee,
                taxMinor: tax,
                unitsHeld: s.units,
              });
          redemptions.set(e.id, r);
          s.investedMinor = r.remainingInvestedMinor;
          s.currentValueMinor = r.full ? 0 : sub(s.currentValueMinor, r.amountMinor);
          s.realizedGainMinor = add(s.realizedGainMinor, r.realizedGainMinor);
          s.feesPaidMinor = add(s.feesPaidMinor, fee);
          s.taxWithheldMinor = add(s.taxWithheldMinor, tax);
          if (s.units !== null && r.unitsRemoved !== null)
            s.units = roundUnits(s.units - r.unitsRemoved);
          if (byUnits) s.lastPriceMinorE4 = e.priceMinorE4!;
          s.fullyRedeemed = r.full;
          if (!r.full) priceValue();
          break;
        }
        case "investment_income":
          s.incomeReceivedMinor = add(s.incomeReceivedMinor, e.amountMinor);
          s.taxWithheldMinor = add(s.taxWithheldMinor, tax);
          if (e.reinvest) {
            const net = sub(e.amountMinor, tax);
            s.investedMinor = add(s.investedMinor, net);
            if (!opts.valueAt) s.currentValueMinor = add(s.currentValueMinor, net);
            addUnits(e.units);
            priceValue();
          }
          break;
      }
    }
    const last = timeline.at(-1);
    const point = { date: e.date, investedMinor: s.investedMinor, valueMinor: s.currentValueMinor };
    if (last?.date === e.date) timeline[timeline.length - 1] = point;
    else timeline.push(point);
  }

  if (opts.valueAt && !s.fullyRedeemed && sorted.length) {
    // FD value keeps accruing after the last event; callers pass `until` = today for "now".
    s.currentValueMinor = opts.valueAt(opts.until ?? sorted.at(-1)!.date);
  }
  s.avgCostMinor = s.units && s.units > 0 ? Math.round(s.investedMinor / s.units) : null;
  return { state: s, redemptions, timeline };
}

/** Unrealised gain = value − invested. */
export function unrealizedGainMinor(
  s: Pick<HoldingState, "currentValueMinor" | "investedMinor">,
): number {
  return sub(s.currentValueMinor, s.investedMinor);
}

/** Total return = unrealised + realised + income − tax withheld. */
export function totalReturnMinor(s: HoldingState): number {
  return (
    add(unrealizedGainMinor(s), s.realizedGainMinor, s.incomeReceivedMinor) - s.taxWithheldMinor
  );
}

/**
 * Investor cash flows for XIRR (docs/04 §5): invest −(amount+fee); redeem +(amount−fee−tax);
 * income paid out +(amount−tax); reinvested income: none; opening_balance −amount; terminal
 * +currentValue on `today` for active holdings.
 */
export function holdingCashFlows(
  events: readonly HoldingEvent[],
  terminal: { date: string; valueMinor: number } | null,
): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const e of events) {
    if (e.kind !== "txn") continue;
    const fee = e.feeMinor ?? 0;
    const tax = e.taxMinor ?? 0;
    if (e.type === "opening_balance") flows.push({ date: e.date, amountMinor: -e.amountMinor });
    if (e.type === "invest") flows.push({ date: e.date, amountMinor: -(e.amountMinor + fee) });
    if (e.type === "redeem") flows.push({ date: e.date, amountMinor: e.amountMinor - fee - tax });
    if (e.type === "investment_income" && !e.reinvest) {
      flows.push({ date: e.date, amountMinor: e.amountMinor - tax });
    }
  }
  if (terminal && terminal.valueMinor > 0)
    flows.push({ date: terminal.date, amountMinor: terminal.valueMinor });
  return flows;
}

/** docs/04 §12: active non-FD holding with value > 0 not valued for more than `staleDays`. */
export function isStale(input: {
  active: boolean;
  isFd: boolean;
  currentValueMinor: number;
  lastValuedAt: string | null;
  today: string;
  staleDays: number;
}): boolean {
  if (!input.active || input.isFd || input.currentValueMinor <= 0) return false;
  if (!input.lastValuedAt) return true;
  return daysBetween(input.lastValuedAt, input.today) > input.staleDays;
}

/** Days since the last valuation (for the "Stale · 34d" badge). */
export function staleDays(lastValuedAt: string | null, today: string): number | null {
  return lastValuedAt ? daysBetween(lastValuedAt, today) : null;
}

/** docs/04 §12: |new − old| / old > threshold (old = 0 counts as big unless new is 0 too). */
export function isBigChange(oldMinor: number, newMinor: number, thresholdBp: number): boolean {
  if (oldMinor === 0) return newMinor !== 0;
  // Exact: |new − old| × 10000 > threshold × |old| (rounding to bp would hide 20.001% vs 20%).
  const diff = BigInt(Math.abs(newMinor - oldMinor));
  return diff * 10_000n > BigInt(thresholdBp) * BigInt(Math.abs(oldMinor));
}
