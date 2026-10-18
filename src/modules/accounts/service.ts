import "server-only";
import type { ClientSession } from "mongoose";
import { cardOutstandingMinor, cardUtilisationBp, nextMonthlyDate } from "@/domain/accounts";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { reconcileAdjustment } from "@/domain/ledger";
import { formatMoney } from "@/lib/format";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import {
  archiveAccountSchema,
  createAccountSchema,
  reconcileAccountSchema,
  updateAccountSchema,
  type AccountDTO,
} from "@/modules/accounts/schemas";
import { TransactionModel } from "@/modules/transactions/model";
import { hasEarmarks } from "@/modules/earmarks/service";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { postTransaction } from "@/server/ledger/post";
import { recomputeAccount } from "@/server/ledger/recompute";

export function toAccountDTO(doc: AccountDoc, tz: string, todayKey?: string): AccountDTO {
  const card =
    doc.type === "credit_card" && doc.creditCard
      ? {
          outstandingMinor: cardOutstandingMinor(doc.balanceMinor),
          utilisationBp: cardUtilisationBp(doc.balanceMinor, doc.creditCard.limitMinor),
          nextDueDate: nextMonthlyDate(
            todayKey ?? utcToBusinessDate(new Date(), tz),
            doc.creditCard.dueDay,
          ),
        }
      : null;
  return {
    id: String(doc._id),
    name: doc.name,
    type: doc.type,
    currency: doc.currency,
    institution: doc.institution ?? null,
    notes: doc.notes ?? null,
    color: doc.color ?? null,
    openingBalanceMinor: doc.openingBalanceMinor,
    openingDate: utcToBusinessDate(doc.openingDate, tz),
    includeInNetWorth: doc.includeInNetWorth,
    countsTowardEmergencyFund: doc.countsTowardEmergencyFund,
    creditCard: doc.creditCard
      ? {
          limitMinor: doc.creditCard.limitMinor,
          statementDay: doc.creditCard.statementDay,
          dueDay: doc.creditCard.dueDay,
        }
      : null,
    counterparty: doc.counterparty ?? null,
    balanceMinor: doc.balanceMinor,
    lastTransactionAt: doc.lastTransactionAt ? doc.lastTransactionAt.toISOString() : null,
    archived: Boolean(doc.archivedAt),
    card,
  };
}

async function loadOwned(ctx: Ctx, id: string, session?: ClientSession): Promise<AccountDoc> {
  const doc = await AccountModel.findOne({
    _id: toObjectId(id, "Account"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session ?? null)
    .lean<AccountDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Account not found");
  return doc;
}

async function hasTransactions(account: AccountDoc, session: ClientSession): Promise<boolean> {
  const found = await TransactionModel.exists({
    userId: account.userId,
    $or: [{ fromAccountId: account._id }, { toAccountId: account._id }],
  }).session(session);
  return Boolean(found);
}

export async function listAccounts(
  ctx: Ctx,
  opts: { includeArchived?: boolean } = {},
): Promise<AccountDTO[]> {
  await connectDb();
  const docs = await AccountModel.find({
    userId: toObjectId(ctx.userId, "User"),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  })
    .sort({ name: 1 })
    .lean<AccountDoc[]>();
  const today = utcToBusinessDate(new Date(), ctx.tz);
  return docs.map((d) => toAccountDTO(d, ctx.tz, today));
}

export async function getAccount(ctx: Ctx, id: string): Promise<AccountDTO> {
  await connectDb();
  return toAccountDTO(await loadOwned(ctx, id), ctx.tz);
}

export async function createAccount(ctx: Ctx, input: unknown): Promise<AccountDTO> {
  const data = parseInput(createAccountSchema, input);
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const [doc] = await AccountModel.create(
      [
        {
          ...data,
          userId,
          openingDate: businessDateToUtc(data.openingDate, ctx.tz),
          balanceMinor: data.openingBalanceMinor,
          counterparty:
            data.type === "receivable" || data.type === "payable" ? data.counterparty : null,
        },
      ],
      { session },
    );
    await recomputeAccount(userId, doc!._id, session);
    await writeAudit(
      { userId: ctx.userId, action: "create", entity: "account", entityId: doc!._id, after: data },
      session,
    );
    return toAccountDTO(await loadOwned(ctx, String(doc!._id), session), ctx.tz);
  });
}

export async function updateAccount(ctx: Ctx, id: string, input: unknown): Promise<AccountDTO> {
  const data = parseInput(updateAccountSchema, input);
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (
      data.currency &&
      data.currency !== current.currency &&
      (await hasTransactions(current, session))
    ) {
      throw new AppError("CONFLICT", "Currency cannot change once the account has transactions", {
        currency: ["Account already has transactions"],
      });
    }
    if (
      data.countsTowardEmergencyFund === true &&
      !current.countsTowardEmergencyFund &&
      (await hasEarmarks(current.userId, current._id, session))
    ) {
      // docs/04 §20: a dedicated emergency account is emergency money as a whole.
      const message = "Remove this account's earmarks first";
      throw new AppError("CONFLICT", message, { countsTowardEmergencyFund: [message] });
    }
    if (data.creditCard !== undefined && current.type !== "credit_card" && data.creditCard) {
      throw new AppError("VALIDATION", "Only credit cards have a limit");
    }
    if (current.type === "credit_card" && data.creditCard === null) {
      throw new AppError("VALIDATION", "Enter the card's limit and days", {
        creditCard: ["Required for credit cards"],
      });
    }
    const $set: Record<string, unknown> = { ...data };
    if (data.openingDate) {
      const openingDate = businessDateToUtc(data.openingDate, ctx.tz);
      const earlier = await TransactionModel.exists({
        userId: current.userId,
        status: "posted",
        date: { $lt: openingDate },
        $or: [{ fromAccountId: current._id }, { toAccountId: current._id }],
      }).session(session);
      if (earlier) {
        throw new AppError("VALIDATION", "Transactions exist before that date", {
          openingDate: ["Some transactions are dated before it"],
        });
      }
      $set.openingDate = openingDate;
    }
    await AccountModel.updateOne(
      { _id: current._id, userId: current.userId },
      { $set },
      { session },
    );
    if (data.openingBalanceMinor !== undefined) {
      await recomputeAccount(current.userId, current._id, session, { audit: true });
    }
    await writeAudit(
      {
        userId: ctx.userId,
        action: "update",
        entity: "account",
        entityId: current._id,
        after: data,
      },
      session,
    );
    return toAccountDTO(await loadOwned(ctx, id, session), ctx.tz);
  });
}

/**
 * Reconcile (docs/04 §1): posts an `adjustment` for real − recorded balance in "Balance
 * adjustment". Returns null when the balances already match.
 */
export async function reconcileAccount(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ account: AccountDTO; adjustmentMinor: number }> {
  const data = parseInput(reconcileAccountSchema, input);
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.archivedAt)
      throw new AppError("CONFLICT", "Restore the account before reconciling");
    const adj = reconcileAdjustment(current.balanceMinor, data.realBalanceMinor);
    if (adj) {
      await postTransaction(
        ctx,
        {
          type: "adjustment",
          date: businessDateToUtc(data.date, ctx.tz),
          amountMinor: adj.amountMinor,
          fromAccountId: adj.direction === "from" ? id : null,
          toAccountId: adj.direction === "to" ? id : null,
          description: "Reconciliation",
          source: { kind: "reconcile", refId: current._id },
        },
        session,
      );
    }
    const signed = adj ? (adj.direction === "to" ? adj.amountMinor : -adj.amountMinor) : 0;
    return {
      account: toAccountDTO(await loadOwned(ctx, id, session), ctx.tz),
      adjustmentMinor: signed,
    };
  });
}

/** Archive (docs/04 §18): a non-zero balance needs explicit confirmation (`force`). */
export async function archiveAccount(ctx: Ctx, id: string, input: unknown): Promise<AccountDTO> {
  const { force } = parseInput(archiveAccountSchema, input ?? {});
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.archivedAt) return toAccountDTO(current, ctx.tz);
    if (current.balanceMinor !== 0 && !force) {
      throw new AppError(
        "CONFLICT",
        `"${current.name}" still has a balance of ${formatMoney(current.balanceMinor, current.currency)}. Confirm to archive anyway.`,
      );
    }
    const archivedAt = new Date();
    await AccountModel.updateOne(
      { _id: current._id, userId: current.userId },
      { $set: { archivedAt } },
      { session },
    );
    await writeAudit(
      { userId: ctx.userId, action: "archive", entity: "account", entityId: current._id },
      session,
    );
    return toAccountDTO({ ...current, archivedAt }, ctx.tz);
  });
}

export async function unarchiveAccount(ctx: Ctx, id: string): Promise<AccountDTO> {
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    await AccountModel.updateOne(
      { _id: current._id, userId: current.userId },
      { $set: { archivedAt: null } },
      { session },
    );
    await writeAudit(
      { userId: ctx.userId, action: "unarchive", entity: "account", entityId: current._id },
      session,
    );
    return toAccountDTO({ ...current, archivedAt: null }, ctx.tz);
  });
}
