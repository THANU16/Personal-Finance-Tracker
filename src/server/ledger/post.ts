import "server-only";
import type { ClientSession, Types } from "mongoose";
import { minorUnitDigits } from "@/domain/money";
import { utcToBusinessDate } from "@/domain/dates";
import { validateSplits } from "@/domain/ledger";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { assertUsableCategory, getSystemCategoryId } from "@/modules/categories/service";
import { SYSTEM_CATEGORY } from "@/modules/categories/seed";
import {
  TransactionModel,
  type SourceKind,
  type TransactionDoc,
} from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";
import { recomputeAccounts } from "@/server/ledger/recompute";

/** Ledger types that can be posted so far (invest/redeem/income: Phase 3; debt_payment: Phase 8). */
export type PostableType = "income" | "expense" | "transfer" | "adjustment";

export interface LedgerDraft {
  type: PostableType;
  /** Stored instant (business date at local midnight). */
  date: Date;
  amountMinor: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  toAmountMinor?: number | null;
  categoryId?: string | null;
  splits?: { categoryId: string; amountMinor: number; note?: string | null }[] | null;
  description?: string | null;
  counterparty?: string | null;
  notes?: string | null;
  tags?: string[];
  source?: { kind: SourceKind; refId?: Types.ObjectId | null };
  groupId?: Types.ObjectId | null;
}

const SPLIT_MESSAGES = {
  too_few_lines: "A split needs at least two lines",
  non_positive_line: "Every split line needs an amount above zero",
  sum_mismatch: "Split lines must add up to the total",
  duplicate_category: "Use each category once per split",
} as const;

const fail = (field: string, message: string): never => {
  throw new AppError("VALIDATION", message, { [field]: [message] });
};

async function loadAccount(
  ctx: Ctx,
  id: string,
  field: string,
  date: Date,
  session: ClientSession,
): Promise<AccountDoc> {
  const account = await AccountModel.findOne({
    _id: toObjectId(id, "Account"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<AccountDoc>();
  if (!account) return fail(field, "Account not found");
  if (account.archivedAt) return fail(field, `"${account.name}" is archived`);
  if (utcToBusinessDate(date, ctx.tz) < utcToBusinessDate(account.openingDate, ctx.tz)) {
    fail("date", `Date is before "${account.name}" was opened (its opening balance date)`);
  }
  return account;
}

/** Major-unit exchange rate implied by a cross-currency transfer (quote per 1 source unit). */
function impliedRate(amountMinor: number, fromCcy: string, toAmountMinor: number, toCcy: string) {
  const from = amountMinor / 10 ** minorUnitDigits(fromCcy);
  const to = toAmountMinor / 10 ** minorUnitDigits(toCcy);
  return Number((to / from).toPrecision(12));
}

/**
 * Validates references and posts one transaction, then recomputes the accounts it touches.
 * Must run inside `withTransaction` — every write uses `session`.
 */
export async function postTransaction(
  ctx: Ctx,
  draft: LedgerDraft,
  session: ClientSession,
): Promise<TransactionDoc> {
  const userId = toObjectId(ctx.userId, "User");
  const needsFrom = draft.type === "expense" || draft.type === "transfer";
  const needsTo = draft.type === "income" || draft.type === "transfer";
  if (needsFrom && !draft.fromAccountId) fail("fromAccountId", "Choose an account");
  if (needsTo && !draft.toAccountId) fail("toAccountId", "Choose an account");
  if (draft.type === "adjustment" && Boolean(draft.fromAccountId) === Boolean(draft.toAccountId)) {
    throw new AppError("VALIDATION", "An adjustment touches exactly one account");
  }
  if (draft.type === "transfer" && draft.fromAccountId === draft.toAccountId) {
    fail("toAccountId", "Choose a different account");
  }
  if (!Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) {
    fail("amountMinor", "Enter an amount above zero");
  }

  const from = draft.fromAccountId
    ? await loadAccount(ctx, draft.fromAccountId, "fromAccountId", draft.date, session)
    : null;
  const to = draft.toAccountId
    ? await loadAccount(ctx, draft.toAccountId, "toAccountId", draft.date, session)
    : null;
  const currency = (from ?? to)!.currency;

  let toAmountMinor: number | null = null;
  let fxRate: number | null = null;
  if (draft.type === "transfer" && from && to && from.currency !== to.currency) {
    if (!draft.toAmountMinor || draft.toAmountMinor <= 0) {
      fail("toAmountMinor", `Enter the amount received in ${to.currency}`);
    }
    toAmountMinor = draft.toAmountMinor!;
    fxRate = impliedRate(draft.amountMinor, from.currency, toAmountMinor, to.currency);
  }

  let categoryId: Types.ObjectId | null = null;
  let splits: { categoryId: Types.ObjectId; amountMinor: number; note: string | null }[] = [];
  if (draft.type === "income") {
    if (!draft.categoryId) fail("categoryId", "Choose a category");
    categoryId = (await assertUsableCategory(ctx, draft.categoryId!, "income", session))._id;
  } else if (draft.type === "expense") {
    const hasSplits = Boolean(draft.splits?.length);
    if (hasSplits === Boolean(draft.categoryId)) {
      fail("categoryId", "Choose a category or split the amount");
    }
    if (hasSplits) {
      const error = validateSplits(draft.amountMinor, draft.splits!);
      if (error) fail("splits", SPLIT_MESSAGES[error]);
      for (const s of draft.splits!) {
        const cat = await assertUsableCategory(ctx, s.categoryId, "expense", session);
        splits.push({ categoryId: cat._id, amountMinor: s.amountMinor, note: s.note ?? null });
      }
    } else {
      categoryId = (await assertUsableCategory(ctx, draft.categoryId!, "expense", session))._id;
    }
  } else if (draft.type === "adjustment") {
    categoryId = await getSystemCategoryId(
      ctx,
      SYSTEM_CATEGORY.balanceAdjustment,
      "expense",
      session,
    );
  }
  if (draft.type === "transfer") splits = [];

  const [doc] = await TransactionModel.create(
    [
      {
        userId,
        type: draft.type,
        date: draft.date,
        amountMinor: draft.amountMinor,
        currency,
        fromAccountId: from?._id ?? null,
        toAccountId: to?._id ?? null,
        toAmountMinor,
        fxRate,
        categoryId,
        splits,
        description: draft.description || null,
        counterparty: draft.counterparty || null,
        notes: draft.notes || null,
        tags: draft.tags ?? [],
        source: { kind: draft.source?.kind ?? "manual", refId: draft.source?.refId ?? null },
        groupId: draft.groupId ?? null,
        status: "posted",
      },
    ],
    { session },
  );
  const txn = doc!.toObject() as TransactionDoc;

  await recomputeAccounts(userId, [txn.fromAccountId, txn.toAccountId], session);
  await writeAudit(
    { userId: ctx.userId, action: "post", entity: "transaction", entityId: txn._id, after: txn },
    session,
  );
  return txn;
}
