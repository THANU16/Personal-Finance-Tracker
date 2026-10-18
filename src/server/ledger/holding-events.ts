import "server-only";
import type { ClientSession, Types } from "mongoose";
import { utcToBusinessDate } from "@/domain/dates";
import { fdValue, type FdTerms } from "@/domain/fd";
import type { HoldingEvent, HoldingTxnType } from "@/domain/holdings";
import {
  HoldingModel,
  ValuationModel,
  type HoldingDoc,
  type ValuationDoc,
} from "@/modules/holdings/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";

export const HOLDING_TXN_TYPES: HoldingTxnType[] = [
  "opening_balance",
  "invest",
  "redeem",
  "investment_income",
];

export function fdTerms(holding: HoldingDoc, tz: string): FdTerms | null {
  if (!holding.fd) return null;
  return {
    principalMinor: holding.fd.principalMinor,
    rateBp: holding.fd.rateBp,
    startDate: utcToBusinessDate(holding.fd.startDate, tz),
    maturityDate: utcToBusinessDate(holding.fd.maturityDate, tz),
    compounding: holding.fd.compounding,
    payout: holding.fd.payout,
  };
}

/** FD value function for replay, or undefined for market-valued holdings. */
export function fdValueAt(holding: HoldingDoc, tz: string): ((d: string) => number) | undefined {
  const terms = fdTerms(holding, tz);
  return terms ? (d: string) => fdValue(terms, d) : undefined;
}

/** Posted holding transactions + valuations as pure replay events (business dates in `tz`). */
export async function loadHoldingEvents(
  userId: Types.ObjectId,
  holdingId: Types.ObjectId,
  tz: string,
  session: ClientSession | null,
): Promise<{ events: HoldingEvent[]; txns: TransactionDoc[]; valuations: ValuationDoc[] }> {
  const [txns, valuations] = await Promise.all([
    TransactionModel.find({
      userId,
      holdingId,
      status: "posted",
      type: { $in: HOLDING_TXN_TYPES },
    })
      .session(session)
      .lean<TransactionDoc[]>(),
    ValuationModel.find({ userId, holdingId }).session(session).lean<ValuationDoc[]>(),
  ]);
  const events: HoldingEvent[] = [
    ...txns.map((t): HoldingEvent => ({
      kind: "txn",
      id: String(t._id),
      type: t.type as HoldingTxnType,
      date: utcToBusinessDate(t.date, tz),
      seq: t.createdAt.getTime(),
      amountMinor: t.amountMinor,
      feeMinor: t.feeMinor ?? 0,
      taxMinor: t.taxMinor ?? 0,
      units: t.units ?? null,
      priceMinorE4: t.priceMinorE4 ?? null,
      reinvest: t.reinvest ?? null,
    })),
    ...valuations.map((v): HoldingEvent => ({
      kind: "valuation",
      id: String(v._id),
      date: utcToBusinessDate(v.date, tz),
      seq: v.createdAt.getTime(),
      valueMinor: v.valueMinor,
      priceMinorE4: v.priceMinorE4 ?? null,
      units: v.units ?? null,
    })),
  ];
  return { events, txns, valuations };
}

export async function loadHoldingDoc(
  userId: Types.ObjectId,
  holdingId: Types.ObjectId,
  session: ClientSession | null,
): Promise<HoldingDoc | null> {
  return HoldingModel.findOne({ _id: holdingId, userId }).session(session).lean<HoldingDoc>();
}
