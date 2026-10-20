import "server-only";
import { Types, type ClientSession } from "mongoose";
import { businessDateToUtc } from "@/domain/dates";
import { AttachmentModel } from "@/modules/attachments/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import {
  OWNER_MANAGED_SOURCES,
  TransactionModel,
  type TransactionDoc,
} from "@/modules/transactions/model";
import {
  transactionInputSchema,
  voidTransactionSchema,
  type TransactionData,
} from "@/modules/transactions/schemas";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { guardedOutflow, postTransaction, type LedgerDraft } from "@/server/ledger/post";
import { voidTransaction as ledgerVoid } from "@/server/ledger/void";

/** Types a user can create and edit directly; others come from their owning feature. */
export const USER_EDITABLE_TYPES = [
  "income",
  "expense",
  "transfer",
  "invest",
  "redeem",
  "investment_income",
] as const;

function toDraft(ctx: Ctx, data: TransactionData): LedgerDraft {
  const common = {
    date: businessDateToUtc(data.date, ctx.tz),
    amountMinor: data.amountMinor ?? 0,
    description: data.description,
    counterparty: data.counterparty,
    notes: data.notes,
    tags: data.tags,
    confirmOpportunity: data.confirmOpportunity ?? false,
    confirmEmergency: data.confirmEmergency ?? false,
  };
  switch (data.type) {
    case "income":
      return {
        ...common,
        type: "income",
        toAccountId: data.toAccountId,
        categoryId: data.categoryId,
      };
    case "expense":
      return {
        ...common,
        type: "expense",
        fromAccountId: data.fromAccountId,
        categoryId: data.splits?.length ? null : (data.categoryId ?? null),
        splits: data.splits?.length ? data.splits : null,
      };
    case "transfer":
      return {
        ...common,
        type: "transfer",
        fromAccountId: data.fromAccountId ?? null,
        toAccountId: data.toAccountId ?? null,
        toAmountMinor: data.toAmountMinor ?? null,
        feeMinor: data.feeMinor,
      };
    case "invest":
      return {
        ...common,
        type: "invest",
        fromAccountId: data.fromAccountId,
        holdingId: data.holdingId,
        feeMinor: data.feeMinor,
        units: data.units ?? null,
        priceMinorE4: data.priceMinorE4 ?? null,
      };
    case "redeem":
      return {
        ...common,
        type: "redeem",
        toAccountId: data.toAccountId,
        holdingId: data.holdingId,
        feeMinor: data.feeMinor,
        taxMinor: data.taxMinor,
        units: data.units ?? null,
        priceMinorE4: data.priceMinorE4 ?? null,
      };
    case "investment_income":
      return {
        ...common,
        type: "investment_income",
        holdingId: data.holdingId,
        toAccountId: data.reinvest ? null : (data.toAccountId ?? null),
        taxMinor: data.taxMinor,
        incomeKind: data.incomeKind,
        reinvest: data.reinvest,
        units: data.reinvest ? (data.units ?? null) : null,
      };
  }
}

type TransferData = Extract<TransactionData, { type: "transfer" }>;

/**
 * A transfer with an asset on either side (owner request): account → asset = invest, asset →
 * account = redeem, asset → asset = switch (redeem from A + invest into B in one DB transaction,
 * sharing a groupId). The amount arrives at the destination; the fee leaves the source on top.
 */
async function postAssetTransfer(
  ctx: Ctx,
  data: TransferData,
  session: ClientSession,
): Promise<{ id: string }> {
  const common = {
    date: businessDateToUtc(data.date, ctx.tz),
    description: data.description,
    counterparty: data.counterparty,
    notes: data.notes,
    tags: data.tags,
    confirmOpportunity: data.confirmOpportunity ?? false,
    confirmEmergency: data.confirmEmergency ?? false,
  };
  const amount = data.amountMinor;
  const fee = data.feeMinor;
  if (data.fromAccountId && data.toHoldingId) {
    const txn = await postTransaction(
      ctx,
      {
        ...common,
        type: "invest",
        amountMinor: amount,
        feeMinor: fee,
        fromAccountId: data.fromAccountId,
        holdingId: data.toHoldingId,
      },
      session,
    );
    return { id: String(txn._id) };
  }
  if (data.fromHoldingId && data.toAccountId) {
    const txn = await postTransaction(
      ctx,
      {
        ...common,
        type: "redeem",
        amountMinor: amount + fee,
        feeMinor: fee,
        toAccountId: data.toAccountId,
        holdingId: data.fromHoldingId,
      },
      session,
    );
    return { id: String(txn._id) };
  }
  const userId = toObjectId(ctx.userId, "User");
  const holdings = await HoldingModel.find({
    userId,
    _id: {
      $in: [toObjectId(data.fromHoldingId!, "Holding"), toObjectId(data.toHoldingId!, "Holding")],
    },
  })
    .session(session)
    .lean<HoldingDoc[]>();
  const a = holdings.find((h) => String(h._id) === data.fromHoldingId);
  const b = holdings.find((h) => String(h._id) === data.toHoldingId);
  if (!a)
    throw new AppError("VALIDATION", "Holding not found", { fromAccountId: ["Holding not found"] });
  if (!b)
    throw new AppError("VALIDATION", "Holding not found", { toAccountId: ["Holding not found"] });
  if (a.currency !== b.currency) {
    const message = `"${a.name}" is in ${a.currency} but "${b.name}" is in ${b.currency}; switch between assets of one currency`;
    throw new AppError("VALIDATION", message, { toAccountId: [message] });
  }
  const groupId = new Types.ObjectId();
  const leg = { ...common, switchLeg: true, groupId, source: { kind: "switch" as const } };
  await postTransaction(
    ctx,
    {
      ...leg,
      type: "redeem",
      amountMinor: amount + fee,
      feeMinor: fee,
      holdingId: data.fromHoldingId!,
    },
    session,
  );
  const invest = await postTransaction(
    ctx,
    { ...leg, type: "invest", amountMinor: amount, feeMinor: 0, holdingId: data.toHoldingId! },
    session,
  );
  return { id: String(invest._id) };
}

export async function createTransaction(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(transactionInputSchema, input);
  return withTransaction(async (session) => {
    if (data.type === "transfer" && (data.fromHoldingId || data.toHoldingId)) {
      return postAssetTransfer(ctx, data, session);
    }
    const txn = await postTransaction(ctx, toDraft(ctx, data), session);
    return { id: String(txn._id) };
  });
}

/** Edit = void the original + post the replacement, atomically (docs/04 §18). */
export async function updateTransaction(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ id: string }> {
  const data = parseInput(transactionInputSchema, input);
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const old = await TransactionModel.findOne({ _id: toObjectId(id, "Transaction"), userId })
      .session(session)
      .lean<TransactionDoc>();
    if (!old) throw new AppError("NOT_FOUND", "Transaction not found");
    if (old.status === "void")
      throw new AppError("CONFLICT", "A void transaction cannot be edited");
    if (OWNER_MANAGED_SOURCES.includes(old.source.kind)) {
      throw new AppError("FORBIDDEN", "Edit this through the operation that created it");
    }
    if (old.source.kind === "switch") {
      throw new AppError(
        "FORBIDDEN",
        "A switch between assets cannot be edited; void it and enter it again",
      );
    }
    if (data.type === "transfer" && (data.fromHoldingId || data.toHoldingId)) {
      throw new AppError("VALIDATION", "Void this entry and add the asset transfer as a new one");
    }
    if (!(USER_EDITABLE_TYPES as readonly string[]).includes(old.type)) {
      throw new AppError("FORBIDDEN", "This transaction cannot be edited; void it instead");
    }

    await ledgerVoid(ctx, id, "Edited", session);
    const replacement = await postTransaction(
      ctx,
      {
        ...toDraft(ctx, data),
        source: { kind: old.source.kind, refId: old.source.refId },
        groupId: old.groupId,
        // Dip guard checks only an increase over the original outflow on the same account.
        replaces: old.fromAccountId
          ? { fromAccountId: String(old.fromAccountId), outflowMinor: guardedOutflow(old) }
          : null,
      },
      session,
    );
    await TransactionModel.updateOne(
      { _id: old._id, userId },
      { $set: { replacedById: replacement._id } },
      { session },
    );
    // Receipts follow the edit (Phase 11): the replacement owns the attachments now.
    if (old.attachmentIds?.length) {
      await TransactionModel.updateOne(
        { _id: replacement._id, userId },
        { $set: { attachmentIds: old.attachmentIds } },
        { session },
      );
      await AttachmentModel.updateMany(
        { userId, _id: { $in: old.attachmentIds } },
        { $set: { transactionId: replacement._id } },
        { session },
      );
    }
    return { id: String(replacement._id) };
  });
}

export async function voidTransaction(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ id: string }> {
  const { reason } = parseInput(voidTransactionSchema, input);
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const txn = await TransactionModel.findOne({ _id: toObjectId(id, "Transaction"), userId })
      .session(session)
      .lean<TransactionDoc>();
    // Both legs of an asset → asset switch are voided together.
    if (txn?.source.kind === "switch" && txn.groupId && txn.status === "posted") {
      const legs = await TransactionModel.find({ userId, groupId: txn.groupId, status: "posted" })
        .session(session)
        .lean<TransactionDoc[]>();
      for (const leg of legs) await ledgerVoid(ctx, String(leg._id), reason, session);
      return { id };
    }
    await ledgerVoid(ctx, id, reason, session);
    return { id };
  });
}
