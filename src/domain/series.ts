// docs/04 §2, §16, §22 — net worth over time as ONE pass over sorted ledger events. Pure.
import type { AccountType } from "@/domain/accounts";
import { createHoldingReplayer, type HoldingEvent } from "@/domain/holdings";
import { accountEffects, type LedgerTxn } from "@/domain/ledger";

/** Account types whose positive balance counts as cash (runway, snapshots.cashMinor). */
export const CASH_ACCOUNT_TYPES: readonly AccountType[] = [
  "bank",
  "cash",
  "wallet",
  "broker_cash",
  "opportunity_fund",
];

export interface SeriesAccount {
  id: string;
  type: AccountType;
  currency: string;
  includeInNetWorth: boolean;
  openingBalanceMinor: number;
  /** Business date the opening balance applies from. */
  openingDate: string;
}

export interface SeriesHolding {
  id: string;
  currency: string;
  assetClassId: string;
  trackUnits: boolean;
  /** FDs: value on a date from the deposit terms (§9); never the cached value. */
  valueAt?: (date: string) => number;
}

/** A posted transaction with its business date and in-day order. */
export interface SeriesTxn extends LedgerTxn {
  date: string;
  seq: number;
}

export interface SeriesInput {
  accounts: readonly SeriesAccount[];
  holdings: readonly SeriesHolding[];
  /** Posted transactions (void ones are ignored). */
  txns: readonly SeriesTxn[];
  /** Holding events (transactions + valuations) per holding id. */
  holdingEvents: ReadonlyMap<string, readonly HoldingEvent[]>;
  /** Converts to base on a date; null = rate missing (excluded and counted). */
  toBase: (amountMinor: number, currency: string, date: string) => number | null;
}

export interface NetWorthPoint {
  date: string;
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  /** Positive balances of cash-type accounts. */
  cashMinor: number;
  holdingsValueMinor: number;
  investedMinor: number;
  byClass: Record<string, number>;
  byAccountType: Partial<Record<AccountType, number>>;
  /** Holding values in base (allocation drill-down). */
  byHolding: Record<string, number>;
  /** Accounts/holdings left out because no FX rate exists for that date. */
  fxMissing: number;
}

type Item =
  | {
      kind: "acct";
      date: string;
      seq: number;
      effects: { accountId: string; deltaMinor: number }[];
    }
  | { kind: "holding"; date: string; seq: number; holdingId: string; event: HoldingEvent };

/**
 * Closing values at each `bucketEnds` date (ascending). Every event is applied exactly once:
 * account balances move by `accountEffects`, holdings by the same replay rules as recomputeHolding.
 */
export function computeNetWorthSeries(
  input: SeriesInput,
  bucketEnds: readonly string[],
): NetWorthPoint[] {
  const items: Item[] = [];
  for (const t of input.txns) {
    if (t.status !== "posted") continue;
    const effects = accountEffects(t);
    if (effects.length) items.push({ kind: "acct", date: t.date, seq: t.seq, effects });
  }
  for (const [holdingId, events] of input.holdingEvents) {
    for (const event of events) {
      items.push({ kind: "holding", date: event.date, seq: event.seq, holdingId, event });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

  const balances = new Map<string, number>();
  for (const a of input.accounts) balances.set(a.id, 0);
  const replayers = new Map(
    input.holdings.map((h) => [
      h.id,
      createHoldingReplayer({ trackUnits: h.trackUnits, valueAt: h.valueAt }),
    ]),
  );

  const points: NetWorthPoint[] = [];
  let i = 0;
  for (const end of bucketEnds) {
    while (i < items.length && items[i]!.date <= end) {
      const item = items[i]!;
      if (item.kind === "acct") {
        for (const e of item.effects) {
          if (balances.has(e.accountId))
            balances.set(e.accountId, balances.get(e.accountId)! + e.deltaMinor);
        }
      } else {
        replayers.get(item.holdingId)?.apply(item.event);
      }
      i += 1;
    }
    points.push(snapshotAt(input, end, balances, replayers));
  }
  return points;
}

function snapshotAt(
  input: SeriesInput,
  date: string,
  balances: ReadonlyMap<string, number>,
  replayers: ReadonlyMap<string, ReturnType<typeof createHoldingReplayer>>,
): NetWorthPoint {
  const p: NetWorthPoint = {
    date,
    netWorthMinor: 0,
    assetsMinor: 0,
    liabilitiesMinor: 0,
    cashMinor: 0,
    holdingsValueMinor: 0,
    investedMinor: 0,
    byClass: {},
    byAccountType: {},
    byHolding: {},
    fxMissing: 0,
  };
  for (const a of input.accounts) {
    if (!a.includeInNetWorth || a.openingDate > date) continue;
    const native = a.openingBalanceMinor + (balances.get(a.id) ?? 0);
    if (native === 0) continue;
    const v = input.toBase(native, a.currency, date);
    if (v === null) {
      p.fxMissing += 1;
      continue;
    }
    if (v >= 0) p.assetsMinor += v;
    else p.liabilitiesMinor += -v;
    if (v > 0 && CASH_ACCOUNT_TYPES.includes(a.type)) p.cashMinor += v;
    p.byAccountType[a.type] = (p.byAccountType[a.type] ?? 0) + v;
  }
  for (const h of input.holdings) {
    const r = replayers.get(h.id);
    if (!r) continue;
    const native = r.valueOn(date);
    const investedNative = r.state.investedMinor;
    if (native === 0 && investedNative === 0) continue;
    const value = input.toBase(native, h.currency, date);
    const invested = input.toBase(investedNative, h.currency, date);
    if (value === null || invested === null) {
      p.fxMissing += 1;
      continue;
    }
    p.holdingsValueMinor += value;
    p.investedMinor += invested;
    p.assetsMinor += value;
    p.byClass[h.assetClassId] = (p.byClass[h.assetClassId] ?? 0) + value;
    if (value !== 0) p.byHolding[h.id] = value;
  }
  p.netWorthMinor = p.assetsMinor - p.liabilitiesMinor;
  return p;
}

/** docs/04 §2 — net worth as of one date (same single pass with one bucket). */
export function computeNetWorthAsOf(input: SeriesInput, date: string): NetWorthPoint {
  return computeNetWorthSeries(input, [date])[0]!;
}
