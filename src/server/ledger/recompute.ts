import "server-only";
import { Types, type ClientSession } from "mongoose";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { replayHolding, type HoldingState } from "@/domain/holdings";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { fdValueAt, loadHoldingDoc, loadHoldingEvents } from "@/server/ledger/holding-events";
import { computeBalance } from "@/domain/ledger";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import { AppError } from "@/server/errors";
import { LEDGER_PROJECTION, toLedgerTxn } from "@/server/ledger/to-ledger-txn";

/**
 * Rebuilds an account's cached balance and lastTransactionAt from the ledger (docs/04 §1):
 * `balance = openingBalanceMinor + Σ effect(t)` over posted transactions. Never increments.
 * (Phase 8: debt payments also reduce the loan account linked through their debt.)
 */
export async function recomputeAccount(
  userId: Types.ObjectId,
  accountId: Types.ObjectId,
  session: ClientSession | null,
  opts: { audit?: boolean } = {},
): Promise<{ beforeMinor: number; afterMinor: number }> {
  const account = await AccountModel.findOne({ _id: accountId, userId })
    .session(session)
    .lean<AccountDoc>();
  if (!account) throw new AppError("NOT_FOUND", "Account not found");

  const txns = await TransactionModel.find({
    userId,
    status: "posted",
    $or: [{ fromAccountId: accountId }, { toAccountId: accountId }],
  })
    .select(LEDGER_PROJECTION)
    .session(session)
    .lean<TransactionDoc[]>();

  const balanceMinor = computeBalance(
    account.openingBalanceMinor,
    txns.map(toLedgerTxn),
    String(accountId),
  );
  const lastTransactionAt = txns.reduce<Date | null>(
    (max, t) => (!max || t.date > max ? t.date : max),
    null,
  );

  await AccountModel.updateOne(
    { _id: accountId, userId },
    { $set: { balanceMinor, lastTransactionAt } },
    { session: session ?? undefined },
  );
  if (opts.audit && balanceMinor !== account.balanceMinor) {
    await writeAudit(
      {
        userId: String(userId),
        action: "recompute",
        entity: "account",
        entityId: accountId,
        before: { balanceMinor: account.balanceMinor },
        after: { balanceMinor },
      },
      session ?? undefined,
    );
  }
  return { beforeMinor: account.balanceMinor, afterMinor: balanceMinor };
}

/** Recomputes every account a set of transactions touched (deduplicated). */
export async function recomputeAccounts(
  userId: Types.ObjectId,
  accountIds: (Types.ObjectId | null | undefined)[],
  session: ClientSession,
): Promise<void> {
  const unique = new Map<string, Types.ObjectId>();
  for (const id of accountIds) if (id) unique.set(String(id), id);
  for (const id of unique.values()) await recomputeAccount(userId, id, session);
}

/**
 * Rebuilds a holding's caches by replaying its posted transactions and valuations in date order
 * (docs/04 §3). Redemption figures (cost removed, realised gain) are recomputed too, so a
 * backdated buy correctly changes a later redemption. Cash effects never depend on them.
 */
export async function recomputeHolding(
  ctx: { userId: string; tz: string },
  holdingId: Types.ObjectId,
  session: ClientSession | null,
): Promise<HoldingState> {
  const userId = new Types.ObjectId(ctx.userId);
  const holding = await loadHoldingDoc(userId, holdingId, session);
  if (!holding) throw new AppError("NOT_FOUND", "Holding not found");
  const { events, txns } = await loadHoldingEvents(userId, holdingId, ctx.tz, session);
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const valueAt = fdValueAt(holding, ctx.tz);
  const { state, redemptions } = replayHolding(events, {
    trackUnits: holding.trackUnits,
    valueAt,
    until: valueAt ? (events.some((e) => e.date > today) ? undefined : today) : undefined,
  });

  const updates = txns
    .filter((t) => t.type === "redeem")
    .flatMap((t) => {
      const r = redemptions.get(String(t._id));
      if (!r) return [];
      const next = {
        costRemovedMinor: r.costRemovedMinor,
        realizedGainMinor: r.realizedGainMinor,
        unitsRemoved: r.unitsRemoved,
      };
      const prev = t.redemption;
      if (
        prev &&
        prev.costRemovedMinor === next.costRemovedMinor &&
        prev.realizedGainMinor === next.realizedGainMinor &&
        (prev.unitsRemoved ?? null) === next.unitsRemoved
      ) {
        return [];
      }
      return [
        { updateOne: { filter: { _id: t._id, userId }, update: { $set: { redemption: next } } } },
      ];
    });
  if (updates.length) await TransactionModel.bulkWrite(updates, { session: session ?? undefined });

  const toDate = (key: string | null) => (key ? businessDateToUtc(key, ctx.tz) : null);
  await HoldingModel.updateOne(
    { _id: holdingId, userId },
    {
      $set: {
        investedMinor: state.investedMinor,
        currentValueMinor: state.currentValueMinor,
        units: state.units,
        avgCostMinor: state.avgCostMinor,
        realizedGainMinor: state.realizedGainMinor,
        incomeReceivedMinor: state.incomeReceivedMinor,
        feesPaidMinor: state.feesPaidMinor,
        taxWithheldMinor: state.taxWithheldMinor,
        firstInvestedAt: toDate(state.firstInvestedAt),
        lastValuedAt: toDate(state.lastValuedAt),
        lastPriceMinorE4: state.lastPriceMinorE4,
      },
    },
    { session: session ?? undefined },
  );
  return state;
}

/** The holding's replayed state on `dateKey` (inclusive) — e.g. before posting a redemption. */
export async function holdingStateAsOf(
  ctx: { userId: string; tz: string },
  holding: HoldingDoc,
  dateKey: string,
  session: ClientSession | null,
): Promise<HoldingState> {
  const userId = new Types.ObjectId(ctx.userId);
  const { events } = await loadHoldingEvents(userId, holding._id, ctx.tz, session);
  return replayHolding(events, {
    trackUnits: holding.trackUnits,
    valueAt: fdValueAt(holding, ctx.tz),
    until: dateKey,
  }).state;
}
