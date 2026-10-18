import "server-only";
import { utcToBusinessDate } from "@/domain/dates";
import type { HoldingEvent } from "@/domain/holdings";
import type { SeriesInput, SeriesTxn } from "@/domain/series";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { loadToBase } from "@/modules/fx/service";
import {
  HoldingModel,
  ValuationModel,
  type HoldingDoc,
  type ValuationDoc,
} from "@/modules/holdings/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import {
  HOLDING_TXN_TYPES,
  fdValueAt,
  holdingTxnEvent,
  valuationEvent,
} from "@/server/ledger/holding-events";
import { LEDGER_PROJECTION, toLedgerTxn } from "@/server/ledger/to-ledger-txn";

export interface LoadedSeriesInput extends SeriesInput {
  /** First business date with any data (for the "All" preset); null when empty. */
  earliestKey: string | null;
  holdingDocs: HoldingDoc[];
  accountDocs: AccountDoc[];
}

/**
 * Everything the single-pass series needs, in four queries: accounts, holdings, posted
 * transactions (account effects + holding events from the same list) and valuations.
 */
export async function loadSeriesInput(ctx: Ctx): Promise<LoadedSeriesInput> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const [accountDocs, holdingDocs, txns, valuations, toBase] = await Promise.all([
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
    HoldingModel.find({ userId }).lean<HoldingDoc[]>(),
    TransactionModel.find({ userId, status: "posted" })
      .select({ ...LEDGER_PROJECTION, holdingId: 1, units: 1, priceMinorE4: 1 })
      .lean<TransactionDoc[]>(),
    ValuationModel.find({ userId }).lean<ValuationDoc[]>(),
    loadToBase(ctx),
  ]);

  // Many instants share a business date (local midnight); convert each instant once.
  const keyCache = new Map<number, string>();
  const keyOf = (d: Date) => {
    const t = d.getTime();
    let k = keyCache.get(t);
    if (!k) {
      k = utcToBusinessDate(d, ctx.tz);
      keyCache.set(t, k);
    }
    return k;
  };

  const seriesTxns: SeriesTxn[] = [];
  const holdingEvents = new Map<string, HoldingEvent[]>();
  const push = (holdingId: string, e: HoldingEvent) => {
    const list = holdingEvents.get(holdingId);
    if (list) list.push(e);
    else holdingEvents.set(holdingId, [e]);
  };
  let earliest: string | null = null;
  const seen = (key: string) => {
    if (!earliest || key < earliest) earliest = key;
  };

  for (const t of txns) {
    const date = keyOf(t.date);
    seen(date);
    seriesTxns.push({ ...toLedgerTxn(t), date, seq: t.createdAt.getTime() });
    if (t.holdingId && (HOLDING_TXN_TYPES as string[]).includes(t.type)) {
      push(String(t.holdingId), { ...holdingTxnEvent(t, ctx.tz), date });
    }
  }
  for (const v of valuations) {
    const e = valuationEvent(v, ctx.tz);
    seen(e.date);
    push(String(v.holdingId), e);
  }
  for (const a of accountDocs) seen(keyOf(a.openingDate));

  return {
    accounts: accountDocs.map((a) => ({
      id: String(a._id),
      type: a.type,
      currency: a.currency,
      includeInNetWorth: a.includeInNetWorth,
      openingBalanceMinor: a.openingBalanceMinor,
      openingDate: keyOf(a.openingDate),
    })),
    holdings: holdingDocs.map((h) => ({
      id: String(h._id),
      currency: h.currency,
      assetClassId: String(h.assetClassId),
      trackUnits: h.trackUnits,
      valueAt: fdValueAt(h, ctx.tz),
    })),
    txns: seriesTxns,
    holdingEvents,
    toBase,
    earliestKey: earliest,
    holdingDocs,
    accountDocs,
  };
}
