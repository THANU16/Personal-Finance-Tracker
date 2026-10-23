import "server-only";
import type { ClientSession } from "mongoose";
import {
  OWNER_MANAGED_SOURCES,
  TransactionModel,
  type TransactionDoc,
} from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";
import { recomputeDebt } from "@/server/ledger/debt";
import { recomputeAccounts, recomputeHolding } from "@/server/ledger/recompute";
import { canCarryEarmarks, earmarksAfterBucketUndo, type Bucket } from "@/domain/earmarks";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { effectiveEarmarksOf, storeBucketAmounts } from "@/modules/earmarks/service";
import type { Types } from "mongoose";
import { guardedOutflow } from "@/server/ledger/post";

/**
 * Voids a posted transaction (never deleted) and recomputes the accounts it touched.
 * Owner-managed lines (SIP execution, deployment) are voided only through their owner.
 */
export async function voidTransaction(
  ctx: Ctx,
  transactionId: string,
  reason: string,
  session: ClientSession,
  opts: { viaOwner?: boolean } = {},
): Promise<TransactionDoc> {
  const userId = toObjectId(ctx.userId, "User");
  const txn = await TransactionModel.findOne({
    _id: toObjectId(transactionId, "Transaction"),
    userId,
  })
    .session(session)
    .lean<TransactionDoc>();
  if (!txn) throw new AppError("NOT_FOUND", "Transaction not found");
  if (txn.status === "void") throw new AppError("CONFLICT", "This transaction is already void");
  if (!opts.viaOwner && OWNER_MANAGED_SOURCES.includes(txn.source.kind)) {
    throw new AppError(
      "FORBIDDEN",
      "This transaction belongs to a grouped operation; undo it from its owner instead",
    );
  }

  // Bucket tags: undo the earmark change while the balances are still the posted ones.
  const undo = async (
    accountId: Types.ObjectId | null,
    bucket: Bucket | null,
    kind: "spend" | "receive",
    amount: number,
  ) => {
    if (!accountId || !bucket || amount <= 0) return;
    const account = await AccountModel.findOne({ _id: accountId, userId })
      .session(session)
      .lean<AccountDoc>();
    if (!account || !canCarryEarmarks(account)) return;
    const effective = await effectiveEarmarksOf(account, session);
    await storeBucketAmounts(
      ctx,
      account,
      earmarksAfterBucketUndo(effective, bucket, kind, amount),
      "earmark_bucket_undo",
      session,
    );
  };
  await undo(txn.fromAccountId, txn.fromBucket ?? null, "spend", guardedOutflow(txn));
  await undo(
    txn.toAccountId,
    txn.toBucket ?? null,
    "receive",
    txn.toAmountMinor ?? txn.amountMinor,
  );

  const voidedAt = new Date();
  await TransactionModel.updateOne(
    { _id: txn._id, userId, status: "posted" },
    { $set: { status: "void", voidedAt, voidReason: reason } },
    { session },
  );
  await recomputeAccounts(userId, [txn.fromAccountId, txn.toAccountId], session);
  if (txn.holdingId) await recomputeHolding(ctx, txn.holdingId, session);
  if (txn.debtId) await recomputeDebt(ctx, txn.debtId, session);
  await writeAudit(
    {
      userId: ctx.userId,
      action: "void",
      entity: "transaction",
      entityId: txn._id,
      before: { status: "posted" },
      after: { status: "void", voidReason: reason },
    },
    session,
  );
  return { ...txn, status: "void", voidedAt, voidReason: reason };
}
