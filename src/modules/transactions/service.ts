import "server-only";
import { businessDateToUtc } from "@/domain/dates";
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
import { postTransaction, type LedgerDraft } from "@/server/ledger/post";
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
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        toAmountMinor: data.toAmountMinor ?? null,
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

export async function createTransaction(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(transactionInputSchema, input);
  return withTransaction(async (session) => {
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
      },
      session,
    );
    await TransactionModel.updateOne(
      { _id: old._id, userId },
      { $set: { replacedById: replacement._id } },
      { session },
    );
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
    await ledgerVoid(ctx, id, reason, session);
    return { id };
  });
}
