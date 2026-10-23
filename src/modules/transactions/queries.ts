import "server-only";
import type { PipelineStage, Types } from "mongoose";
import { minorToCsv, toCsv } from "@/domain/csv";
import { minorUnitDigits } from "@/domain/money";
import { nextDayKey, resolveDateRange, type DateKeyRange } from "@/domain/date-range";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { categoryWithChildrenIds } from "@/modules/categories/service";
import {
  OWNER_MANAGED_SOURCES,
  TransactionModel,
  type TransactionDoc,
} from "@/modules/transactions/model";
import {
  TRANSACTION_PAGE_SIZE,
  type TransactionDTO,
  type TransactionFilters,
} from "@/modules/transactions/schemas";
import { USER_EDITABLE_TYPES } from "@/modules/transactions/service";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { loadToBase } from "@/modules/fx/service";
import { toObjectId } from "@/server/db/ids";

export interface RefMaps {
  accounts: Map<string, AccountDoc>;
  categories: Map<string, CategoryDoc>;
  holdings: Map<string, HoldingDoc>;
}

/** All of the user's accounts and categories (archived included) for joining names. */
export async function loadRefMaps(userId: Types.ObjectId): Promise<RefMaps> {
  const [accounts, categories, holdings] = await Promise.all([
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
    CategoryModel.find({ userId }).lean<CategoryDoc[]>(),
    HoldingModel.find({ userId }).select({ name: 1 }).lean<HoldingDoc[]>(),
  ]);
  return {
    accounts: new Map(accounts.map((a) => [String(a._id), a])),
    categories: new Map(categories.map((c) => [String(c._id), c])),
    holdings: new Map(holdings.map((h) => [String(h._id), h])),
  };
}

export function toTransactionDTO(doc: TransactionDoc, refs: RefMaps, tz: string): TransactionDTO {
  const account = (id: Types.ObjectId | null) => {
    const a = id ? refs.accounts.get(String(id)) : undefined;
    return a ? { id: String(a._id), name: a.name, currency: a.currency } : null;
  };
  const category = (id: Types.ObjectId | null) => {
    const c = id ? refs.categories.get(String(id)) : undefined;
    return c ? { id: String(c._id), name: c.name } : null;
  };
  const ownerManaged = OWNER_MANAGED_SOURCES.includes(doc.source.kind);
  return {
    id: String(doc._id),
    type: doc.type,
    status: doc.status,
    date: utcToBusinessDate(doc.date, tz),
    amountMinor: doc.amountMinor,
    currency: doc.currency,
    fromAccount: account(doc.fromAccountId),
    toAccount: account(doc.toAccountId),
    toAmountMinor: doc.toAmountMinor ?? null,
    fxRate: doc.fxRate ?? null,
    category: category(doc.categoryId),
    splits: (doc.splits ?? []).map((s) => ({
      category: category(s.categoryId) ?? { id: String(s.categoryId), name: "Unknown" },
      amountMinor: s.amountMinor,
      note: s.note ?? null,
    })),
    holding: doc.holdingId
      ? {
          id: String(doc.holdingId),
          name: refs.holdings.get(String(doc.holdingId))?.name ?? "Unknown holding",
        }
      : null,
    feeMinor: doc.feeMinor ?? 0,
    taxMinor: doc.taxMinor ?? 0,
    units: doc.units ?? null,
    priceMinorE4: doc.priceMinorE4 ?? null,
    incomeKind: doc.incomeKind ?? null,
    reinvest: doc.reinvest ?? null,
    redemption: doc.redemption
      ? {
          costRemovedMinor: doc.redemption.costRemovedMinor,
          realizedGainMinor: doc.redemption.realizedGainMinor,
          unitsRemoved: doc.redemption.unitsRemoved ?? null,
        }
      : null,
    description: doc.description ?? null,
    counterparty: doc.counterparty ?? null,
    notes: doc.notes ?? null,
    tags: doc.tags ?? [],
    attachmentCount: doc.attachmentIds?.length ?? 0,
    fromBucket: doc.fromBucket ?? null,
    toBucket: doc.toBucket ?? null,
    source: doc.source.kind,
    groupId: doc.groupId ? String(doc.groupId) : null,
    voidReason: doc.voidReason ?? null,
    ownerManaged,
    editable:
      doc.status === "posted" &&
      !ownerManaged &&
      doc.source.kind !== "switch" &&
      (USER_EDITABLE_TYPES as readonly string[]).includes(doc.type),
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mongo filter for the /transactions filters (always scoped by userId). */
async function buildFilter(ctx: Ctx, f: TransactionFilters, range: DateKeyRange) {
  const userId = toObjectId(ctx.userId, "User");
  const and: Record<string, unknown>[] = [];
  const filter: Record<string, unknown> = { userId };
  if (!f.voided) filter.status = "posted";
  if (range.from || range.to) {
    filter.date = {
      ...(range.from ? { $gte: businessDateToUtc(range.from, ctx.tz) } : {}),
      ...(range.to ? { $lt: businessDateToUtc(nextDayKey(range.to), ctx.tz) } : {}),
    };
  }
  if (f.types.length) filter.type = { $in: f.types };
  if (f.account) {
    const id = toObjectId(f.account, "Account");
    and.push({ $or: [{ fromAccountId: id }, { toAccountId: id }] });
  }
  if (f.category) {
    const ids = await categoryWithChildrenIds(ctx, f.category);
    and.push({ $or: [{ categoryId: { $in: ids } }, { "splits.categoryId": { $in: ids } }] });
  }
  if (f.holding) filter.holdingId = toObjectId(f.holding, "Holding");
  if (f.tag) filter.tags = f.tag;
  if (f.min || f.max) {
    filter.amountMinor = { ...(f.min ? { $gte: f.min } : {}), ...(f.max ? { $lte: f.max } : {}) };
  }
  if (f.q) {
    const rx = { $regex: escapeRegex(f.q), $options: "i" };
    and.push({ $or: [{ description: rx }, { counterparty: rx }, { notes: rx }] });
  }
  if (and.length) filter.$and = and;
  return filter;
}

export interface TransactionsSummary {
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** Income/expense transactions in other currencies, left out until FX rates exist (Phase 4). */
  /** Transactions in other currencies with no FX rate on their date (left out, badged). */
  fxMissingCount: number;
}

export interface TransactionsPage {
  rows: TransactionDTO[];
  total: number;
  page: number;
  pageCount: number;
  range: DateKeyRange;
  summary: TransactionsSummary;
}

export async function listTransactions(
  ctx: Ctx,
  filters: TransactionFilters,
  todayKey = utcToBusinessDate(new Date(), ctx.tz),
): Promise<TransactionsPage> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const range = resolveDateRange(filters.preset, todayKey, { from: filters.from, to: filters.to });
  const filter = await buildFilter(ctx, filters, range);

  // docs/04 §4: income = income + investment income paid out (reinvested is not cash);
  // expense = expense. A type filter narrows it further.
  const cashflowTypes = ["income", "expense", "investment_income", "transfer"].filter(
    (t) => !filters.types.length || (filters.types as string[]).includes(t),
  );
  const summaryPipeline: PipelineStage[] = [
    {
      $match: {
        ...filter,
        status: "posted",
        type: { $in: cashflowTypes },
        reinvest: { $ne: true },
      },
    },
    {
      $group: {
        // Per business day, so other currencies convert at that day's rate (docs/04 §14).
        _id: {
          type: "$type",
          currency: "$currency",
          day: { $dateToString: { date: "$date", format: "%Y-%m-%d", timezone: ctx.tz } },
        },
        sum: { $sum: "$amountMinor" },
        n: { $sum: 1 },
        // Transfers count only for their fee (an expense); the amount moved is not cashflow.
        fees: { $sum: "$feeMinor" },
        feeN: { $sum: { $cond: [{ $gt: ["$feeMinor", 0] }, 1, 0] } },
      },
    },
  ];

  const [total, docs, groups, refs, toBase] = await Promise.all([
    TransactionModel.countDocuments(filter),
    TransactionModel.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((filters.page - 1) * TRANSACTION_PAGE_SIZE)
      .limit(TRANSACTION_PAGE_SIZE)
      .lean<TransactionDoc[]>(),
    TransactionModel.aggregate<{
      _id: { type: string; currency: string; day: string };
      sum: number;
      n: number;
      fees: number;
      feeN: number;
    }>(summaryPipeline),
    loadRefMaps(userId),
    loadToBase(ctx),
  ]);

  let income = 0;
  let expense = 0;
  let missing = 0;
  for (const g of groups) {
    const isTransfer = g._id.type === "transfer";
    const value = toBase(isTransfer ? g.fees : g.sum, g._id.currency, g._id.day);
    if (value === null) missing += isTransfer ? g.feeN : g.n;
    else if (isTransfer || g._id.type === "expense") expense += value;
    else income += value;
  }

  return {
    rows: docs.map((d) => toTransactionDTO(d, refs, ctx.tz)),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / TRANSACTION_PAGE_SIZE)),
    range,
    summary: {
      currency: ctx.baseCurrency,
      incomeMinor: income,
      expenseMinor: expense,
      netMinor: income - expense,
      fxMissingCount: missing,
    },
  };
}

/** Distinct tags the user has used (for the filter and Quick add suggestions). */
export async function listTags(ctx: Ctx): Promise<string[]> {
  await connectDb();
  const tags = await TransactionModel.distinct("tags", { userId: toObjectId(ctx.userId, "User") });
  return (tags as string[]).sort();
}

export const MAX_EXPORT_ROWS = 50_000;

/** Transactions CSV (Phase 11): the same filters as the list, every page, oldest first. */
export async function exportTransactionsCsv(
  ctx: Ctx,
  filters: TransactionFilters,
  todayKey = utcToBusinessDate(new Date(), ctx.tz),
): Promise<{ fileName: string; csv: string; rows: number }> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const range = resolveDateRange(filters.preset, todayKey, { from: filters.from, to: filters.to });
  const [docs, refs] = await Promise.all([
    TransactionModel.find(await buildFilter(ctx, filters, range))
      .sort({ date: 1, createdAt: 1 })
      .limit(MAX_EXPORT_ROWS)
      .lean<TransactionDoc[]>(),
    loadRefMaps(userId),
  ]);
  const rows = docs.map((d) => toTransactionDTO(d, refs, ctx.tz));
  const money = (v: number | null | undefined, ccy: string) =>
    v === null || v === undefined ? "" : minorToCsv(v, minorUnitDigits(ccy));
  const csv = toCsv(rows, [
    { header: "Date", value: (r) => r.date },
    { header: "Type", value: (r) => r.type },
    { header: "Status", value: (r) => r.status },
    { header: "Amount", value: (r) => money(r.amountMinor, r.currency) },
    { header: "Currency", value: (r) => r.currency },
    { header: "From account", value: (r) => r.fromAccount?.name },
    { header: "To account", value: (r) => r.toAccount?.name },
    {
      header: "To amount",
      value: (r) => money(r.toAmountMinor, r.toAccount?.currency ?? r.currency),
    },
    {
      header: "Category",
      value: (r) =>
        r.splits.length
          ? r.splits
              .map((s) => `${s.category.name}: ${money(s.amountMinor, r.currency)}`)
              .join("; ")
          : r.category?.name,
    },
    { header: "Holding", value: (r) => r.holding?.name },
    { header: "Fee", value: (r) => money(r.feeMinor, r.currency) },
    { header: "Tax", value: (r) => money(r.taxMinor, r.currency) },
    { header: "Units", value: (r) => (r.units === null ? "" : String(r.units)) },
    { header: "Realised gain", value: (r) => money(r.redemption?.realizedGainMinor, r.currency) },
    { header: "Description", value: (r) => r.description },
    { header: "Counterparty", value: (r) => r.counterparty },
    { header: "Notes", value: (r) => r.notes },
    { header: "Tags", value: (r) => r.tags.join(" ") },
    { header: "Source", value: (r) => r.source },
    { header: "Id", value: (r) => r.id },
  ]);
  return {
    fileName: `transactions-${range.from ?? "all"}-${range.to ?? todayKey}.csv`,
    csv,
    rows: rows.length,
  };
}
