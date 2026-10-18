import "server-only";
import type { ClientSession, Types } from "mongoose";
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
