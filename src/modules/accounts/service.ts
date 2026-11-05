import "server-only";
import type { ClientSession } from "mongoose";
import { cardOutstandingMinor, cardUtilisationBp, nextMonthlyDate } from "@/domain/accounts";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import {
  reconcileAdjustment,
  reconcileDefaultRecordAs,
  reconcileRecordAllowed,
  type ReconcileRecordAs,
} from "@/domain/ledger";
import { formatMoney } from "@/lib/format";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import {
  archiveAccountSchema,
  createAccountSchema,
  reconcileAccountSchema,
  updateAccountSchema,
  type AccountDTO,
} from "@/modules/accounts/schemas";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { SYSTEM_CATEGORY } from "@/modules/categories/seed";
import { getSystemCategoryId } from "@/modules/categories/service";
import { TransactionModel } from "@/modules/transactions/model";
import { hasEarmarks } from "@/modules/earmarks/service";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { postTransaction, type LedgerDraft } from "@/server/ledger/post";
import { recomputeAccount } from "@/server/ledger/recompute";
import { voidTransaction as voidLedgerTransaction } from "@/server/ledger/void";

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

/** docs/04 §1 — default reconcile category: "Bank fees" or the user's "Interest" income category. */
export async function defaultReconcileCategoryId(
  ctx: Ctx,
  kind: "expense" | "income",
  session?: ClientSession,
): Promise<string> {
  if (kind === "expense") {
    return String(await getSystemCategoryId(ctx, SYSTEM_CATEGORY.bankFees, "expense", session));
  }
  const interest = await CategoryModel.findOne({
    userId: toObjectId(ctx.userId, "User"),
    kind: "income",
    name: "Interest",
    archivedAt: null,
  })
    .session(session ?? null)
    .lean<CategoryDoc>();
  if (interest) return String(interest._id);
  return String(await getSystemCategoryId(ctx, SYSTEM_CATEGORY.uncategorised, "income", session));
}

/** One reconcile difference as a ledger draft (expense / income / adjustment). */
async function reconcileDraft(
  ctx: Ctx,
  accountId: string,
  adj: { direction: "to" | "from"; amountMinor: number },
  recordAs: ReconcileRecordAs,
  categoryId: string | null | undefined,
  date: Date,
  refId: AccountDoc["_id"],
  session: ClientSession,
): Promise<LedgerDraft> {
  if (!reconcileRecordAllowed(adj.direction, recordAs)) {
    throw new AppError(
      "VALIDATION",
      adj.direction === "from"
        ? "A lower balance is an expense or a balance adjustment"
        : "A higher balance is income or a balance adjustment",
      { recordAs: ["Choose how to record the difference"] },
    );
  }
  const common = {
    date,
    amountMinor: adj.amountMinor,
    description: "Reconciliation",
    source: { kind: "reconcile" as const, refId },
  };
  if (recordAs === "adjustment") {
    return {
      ...common,
      type: "adjustment",
      fromAccountId: adj.direction === "from" ? accountId : null,
      toAccountId: adj.direction === "to" ? accountId : null,
    };
  }
  const category = categoryId ?? (await defaultReconcileCategoryId(ctx, recordAs, session));
  return recordAs === "expense"
    ? { ...common, type: "expense", fromAccountId: accountId, categoryId: category }
    : { ...common, type: "income", toAccountId: accountId, categoryId: category };
}

/**
 * Reconcile (docs/04 §1): posts the real − recorded difference as an expense, income or balance
 * adjustment (default by direction). `adjustmentMinor` is 0 when the balances already match.
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
      const draft = await reconcileDraft(
        ctx,
        id,
        adj,
        data.recordAs ?? reconcileDefaultRecordAs(adj.direction),
        data.categoryId,
        businessDateToUtc(data.date, ctx.tz),
        current._id,
        session,
      );
      await postTransaction(ctx, draft, session);
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

export interface ReconcileConversion {
  transactionId: string;
  date: string;
  accountName: string;
  currency: string;
  /** Signed change to the account (+ income, − expense). */
  amountMinor: number;
  recordAs: "expense" | "income";
  categoryName: string;
  /** Archived accounts are left as adjustments (restore the account first). */
  skipped: string | null;
}

/**
 * One-off (owner request, docs/04 §1): turns existing reconcile adjustments into expense / income
 * with the default categories, as void + repost in ONE DB transaction (balances do not move).
 * Without `apply` it only lists what would change.
 */
export async function convertReconcileAdjustments(
  ctx: Ctx,
  opts: { apply: boolean },
): Promise<ReconcileConversion[]> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const plan = async (session?: ClientSession) => {
    const txns = await TransactionModel.find({
      userId,
      status: "posted",
      type: "adjustment",
      "source.kind": "reconcile",
    })
      .sort({ date: 1, createdAt: 1 })
      .session(session ?? null)
      .lean();
    const accounts = new Map(
      (
        await AccountModel.find({ userId })
          .session(session ?? null)
          .lean<AccountDoc[]>()
      ).map((a) => [String(a._id), a]),
    );
    const categoryNames = new Map<string, string>();
    const categoryOf = async (kind: "expense" | "income") => {
      const id = await defaultReconcileCategoryId(ctx, kind, session);
      if (!categoryNames.has(id)) {
        const doc = await CategoryModel.findOne({ _id: toObjectId(id, "Category"), userId })
          .session(session ?? null)
          .lean<CategoryDoc>();
        categoryNames.set(id, doc?.name ?? "");
      }
      return { id, name: categoryNames.get(id)! };
    };
    const rows = [];
    for (const t of txns) {
      const direction = t.toAccountId ? ("to" as const) : ("from" as const);
      const account = accounts.get(String(t.toAccountId ?? t.fromAccountId));
      if (!account) continue;
      const recordAs = reconcileDefaultRecordAs(direction) as "expense" | "income";
      const category = await categoryOf(recordAs);
      rows.push({
        txn: t,
        direction,
        account,
        category,
        info: {
          transactionId: String(t._id),
          date: utcToBusinessDate(t.date, ctx.tz),
          accountName: account.name,
          currency: account.currency,
          amountMinor: direction === "to" ? t.amountMinor : -t.amountMinor,
          recordAs,
          categoryName: category.name,
          skipped: account.archivedAt ? "account is archived" : null,
        } satisfies ReconcileConversion,
      });
    }
    return rows;
  };

  if (!opts.apply) return (await plan()).map((r) => r.info);
  return withTransaction(async (session) => {
    const rows = await plan(session);
    for (const r of rows) {
      if (r.info.skipped) continue;
      await voidLedgerTransaction(
        ctx,
        r.info.transactionId,
        "Converted to expense / income",
        session,
      );
      const draft = await reconcileDraft(
        ctx,
        String(r.account._id),
        { direction: r.direction, amountMinor: r.txn.amountMinor },
        r.info.recordAs,
        r.category.id,
        r.txn.date,
        r.txn.source.refId ?? r.account._id,
        session,
      );
      await postTransaction(
        ctx,
        { ...draft, description: r.txn.description ?? "Reconciliation" },
        session,
      );
    }
    return rows.map((r) => r.info);
  });
}
