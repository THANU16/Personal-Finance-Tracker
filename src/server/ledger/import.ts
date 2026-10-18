import "server-only";
import { Types, type ClientSession } from "mongoose";
import { utcToBusinessDate } from "@/domain/dates";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { CategoryModel, type CategoryDoc, type CategoryKind } from "@/modules/categories/model";
import { getSystemCategoryId } from "@/modules/categories/service";
import { SYSTEM_CATEGORY } from "@/modules/categories/seed";
import { HoldingModel, ValuationModel, type HoldingDoc } from "@/modules/holdings/model";
import { TransactionModel } from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";
import { recomputeAccounts, recomputeHolding } from "@/server/ledger/recompute";

// Bulk posting for imports (docs/07 §4). Same posting rules as postTransaction, but references are
// loaded once, everything is inserted together and each touched cache is recomputed once — a
// 1,000-row file stays well inside one DB transaction. Imports never run the dip guard
// (historical data).

export type ImportTxnType =
  "income" | "expense" | "transfer" | "invest" | "redeem" | "adjustment" | "opening_balance";

export type ImportEntry =
  | {
      kind: "txn";
      type: ImportTxnType;
      date: Date;
      amountMinor: number;
      feeMinor?: number;
      fromAccountId?: Types.ObjectId | null;
      toAccountId?: Types.ObjectId | null;
      holdingId?: Types.ObjectId | null;
      /** Income/expense category; a "Bank fees" expense passes the system id. */
      categoryId?: Types.ObjectId | null;
      description?: string | null;
      notes?: string | null;
      importHash: string;
      /** A holding → holding move: the redeem and the invest share it and need no account. */
      groupId?: Types.ObjectId | null;
    }
  | {
      kind: "valuation";
      holdingId: Types.ObjectId;
      date: Date;
      valueMinor: number;
      note: string;
    };

const fail = (index: number, message: string): never => {
  throw new AppError("VALIDATION", `Import line ${index + 1}: ${message}`);
};

/**
 * Posts an import batch in entry order. Every entry gets a strictly increasing `createdAt`, so
 * same-day holding events replay in the order Money Manager recorded them. Must run inside
 * `withTransaction`; any invalid entry aborts the whole batch.
 */
export async function postImportBatch(
  ctx: Ctx,
  batchId: Types.ObjectId,
  entries: readonly ImportEntry[],
  session: ClientSession,
): Promise<{ transactions: number; valuations: number }> {
  const userId = toObjectId(ctx.userId, "User");
  const ids = (pick: (e: ImportEntry) => (Types.ObjectId | null | undefined)[]) => [
    ...new Set(entries.flatMap(pick).filter(Boolean).map(String)),
  ];
  const accountIds = ids((e) => (e.kind === "txn" ? [e.fromAccountId, e.toAccountId] : []));
  const holdingIds = ids((e) => [e.holdingId]);
  const categoryIds = ids((e) => (e.kind === "txn" ? [e.categoryId] : []));

  const [accounts, holdings, categories] = await Promise.all([
    AccountModel.find({ userId, _id: { $in: accountIds } })
      .session(session)
      .lean<AccountDoc[]>(),
    HoldingModel.find({ userId, _id: { $in: holdingIds } })
      .session(session)
      .lean<HoldingDoc[]>(),
    CategoryModel.find({ userId, _id: { $in: categoryIds } })
      .session(session)
      .lean<CategoryDoc[]>(),
  ]);
  const accountById = new Map(accounts.map((a) => [String(a._id), a]));
  const holdingById = new Map(holdings.map((h) => [String(h._id), h]));
  const categoryById = new Map(categories.map((c) => [String(c._id), c]));
  const adjustmentCategory = await getSystemCategoryId(
    ctx,
    SYSTEM_CATEGORY.balanceAdjustment,
    "expense",
    session,
  );
  const bankFees = await getSystemCategoryId(ctx, SYSTEM_CATEGORY.bankFees, "expense", session);

  const account = (i: number, id: Types.ObjectId | null | undefined, date: Date) => {
    if (!id) return null;
    const a = accountById.get(String(id));
    if (!a) return fail(i, "account not found");
    if (a.archivedAt) fail(i, `"${a.name}" is archived`);
    if (utcToBusinessDate(date, ctx.tz) < utcToBusinessDate(a.openingDate, ctx.tz)) {
      fail(i, `dated before "${a.name}" was opened`);
    }
    return a;
  };
  const holding = (i: number, id: Types.ObjectId | null | undefined) => {
    if (!id) return null;
    const h = holdingById.get(String(id));
    if (!h) return fail(i, "holding not found");
    if (h.status === "closed") fail(i, `"${h.name}" is closed`);
    if (h.fd)
      fail(i, `"${h.name}" has deposit terms (its value is calculated); imports cannot value it`);
    return h;
  };
  const category = (i: number, id: Types.ObjectId | null | undefined, kind: CategoryKind) => {
    const c = id ? categoryById.get(String(id)) : undefined;
    if (!c) return fail(i, "category not found");
    if (c.archivedAt) fail(i, `category "${c.name}" is archived`);
    if (c.kind !== kind) fail(i, `"${c.name}" is not an ${kind} category`);
    return c._id;
  };

  const base = Date.now() - entries.length - 1;
  const txnDocs: Record<string, unknown>[] = [];
  const valuationDocs: Record<string, unknown>[] = [];
  const touchedAccounts: Types.ObjectId[] = [];
  const touchedHoldings = new Map<string, Types.ObjectId>();

  entries.forEach((e, i) => {
    const createdAt = new Date(base + i);
    if (e.kind === "valuation") {
      const h = holding(i, e.holdingId)!;
      if (!Number.isSafeInteger(e.valueMinor) || e.valueMinor < 0) fail(i, "invalid value");
      valuationDocs.push({
        userId,
        holdingId: h._id,
        date: e.date,
        valueMinor: e.valueMinor,
        priceMinorE4: null,
        units: null,
        source: "import",
        note: e.note,
        importBatchId: batchId,
        createdAt,
        updatedAt: createdAt,
      });
      touchedHoldings.set(String(h._id), h._id);
      return;
    }

    const t = e.type;
    const fee = e.feeMinor ?? 0;
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0)
      fail(i, "amount must be above zero");
    if (!Number.isSafeInteger(fee) || fee < 0) fail(i, "fee cannot be negative");
    const grouped = Boolean(e.groupId);
    const needsFrom = t === "expense" || t === "transfer" || (t === "invest" && !grouped);
    const needsTo = t === "income" || t === "transfer" || (t === "redeem" && !grouped);
    const needsHolding = t === "invest" || t === "redeem" || t === "opening_balance";
    if (needsFrom && !e.fromAccountId) fail(i, "missing source account");
    if (needsTo && !e.toAccountId) fail(i, "missing destination account");
    if (needsHolding && !e.holdingId) fail(i, "missing holding");
    if (t === "adjustment" && Boolean(e.fromAccountId) === Boolean(e.toAccountId)) {
      fail(i, "an adjustment touches exactly one account");
    }
    if (t === "transfer" && String(e.fromAccountId) === String(e.toAccountId)) {
      fail(i, "transfer to the same account");
    }

    const from = account(i, e.fromAccountId, e.date);
    const to = account(i, e.toAccountId, e.date);
    const h = needsHolding ? holding(i, e.holdingId) : null;
    if (h) {
      for (const a of [from, to]) {
        if (a && a.currency !== h.currency)
          fail(i, `"${a.name}" and "${h.name}" differ in currency`);
      }
    }
    if (t === "transfer" && from!.currency !== to!.currency) {
      fail(i, "cross-currency transfers are not imported");
    }
    const currency = h?.currency ?? (from ?? to)!.currency;

    let categoryId: Types.ObjectId | null = null;
    if (t === "income") categoryId = category(i, e.categoryId, "income");
    else if (t === "expense") categoryId = category(i, e.categoryId, "expense");
    else if (t === "adjustment") categoryId = adjustmentCategory;
    else if (t === "transfer" && fee > 0) categoryId = bankFees;

    txnDocs.push({
      userId,
      type: t,
      date: e.date,
      amountMinor: e.amountMinor,
      currency,
      fromAccountId: from?._id ?? null,
      toAccountId: to?._id ?? null,
      toAmountMinor: null,
      fxRate: null,
      categoryId,
      splits: [],
      holdingId: h?._id ?? null,
      units: null,
      priceMinorE4: null,
      feeMinor: t === "invest" || t === "redeem" || t === "transfer" ? fee : 0,
      taxMinor: 0,
      incomeKind: null,
      reinvest: null,
      description: e.description || null,
      notes: e.notes || null,
      tags: [],
      source: { kind: "import", refId: batchId },
      groupId: e.groupId ?? null,
      status: "posted",
      importHash: e.importHash,
      createdAt,
      updatedAt: createdAt,
    });
    if (from) touchedAccounts.push(from._id);
    if (to) touchedAccounts.push(to._id);
    if (h) touchedHoldings.set(String(h._id), h._id);
  });

  if (txnDocs.length) {
    try {
      await TransactionModel.insertMany(txnDocs, { session, ordered: true });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new AppError(
          "CONFLICT",
          "Some of these rows were already imported; reload the preview",
        );
      }
      throw err;
    }
  }
  if (valuationDocs.length)
    await ValuationModel.insertMany(valuationDocs, { session, ordered: true });

  await recomputeAccounts(userId, touchedAccounts, session);
  for (const id of touchedHoldings.values()) await recomputeHolding(ctx, id, session);
  await writeAudit(
    {
      userId: ctx.userId,
      action: "import",
      entity: "importBatch",
      entityId: batchId,
      after: { transactions: txnDocs.length, valuations: valuationDocs.length },
    },
    session,
  );
  return { transactions: txnDocs.length, valuations: valuationDocs.length };
}

/**
 * Undo (docs/07 §4): voids every transaction of the batch (never deleted), removes its valuations
 * and recomputes the caches it touched. Hashes are suffixed so the same rows can be imported again.
 */
export async function voidImportBatch(
  ctx: Ctx,
  batchId: Types.ObjectId,
  session: ClientSession,
): Promise<{ voided: number; valuationsRemoved: number }> {
  const userId = toObjectId(ctx.userId, "User");
  const filter = {
    userId,
    "source.kind": "import" as const,
    "source.refId": batchId,
    status: "posted" as const,
  };
  const txns = await TransactionModel.find(filter)
    .select({ fromAccountId: 1, toAccountId: 1, holdingId: 1 })
    .session(session)
    .lean<
      {
        fromAccountId: Types.ObjectId | null;
        toAccountId: Types.ObjectId | null;
        holdingId: Types.ObjectId | null;
      }[]
    >();
  const valuations = await ValuationModel.find({ userId, importBatchId: batchId })
    .select({ holdingId: 1 })
    .session(session)
    .lean<{ holdingId: Types.ObjectId }[]>();

  const voidedAt = new Date();
  const res = await TransactionModel.updateMany(
    filter,
    [
      {
        $set: {
          status: "void",
          voidedAt,
          voidReason: "Import undone",
          importHash: { $concat: ["$importHash", `:undone:${String(batchId)}`] },
        },
      },
    ],
    { session, updatePipeline: true },
  );
  await ValuationModel.deleteMany({ userId, importBatchId: batchId }, { session });

  await recomputeAccounts(
    userId,
    txns.flatMap((t) => [t.fromAccountId, t.toAccountId]),
    session,
  );
  const holdings = new Map<string, Types.ObjectId>();
  for (const t of txns) if (t.holdingId) holdings.set(String(t.holdingId), t.holdingId);
  for (const v of valuations) holdings.set(String(v.holdingId), v.holdingId);
  for (const id of holdings.values()) await recomputeHolding(ctx, id, session);
  await writeAudit(
    {
      userId: ctx.userId,
      action: "undo_import",
      entity: "importBatch",
      entityId: batchId,
      after: { voided: res.modifiedCount, valuationsRemoved: valuations.length },
    },
    session,
  );
  return { voided: res.modifiedCount, valuationsRemoved: valuations.length };
}

export const isObjectId = (s: string) => Types.ObjectId.isValid(s) && /^[0-9a-f]{24}$/i.test(s);
