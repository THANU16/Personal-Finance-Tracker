import "server-only";
import type { Types } from "mongoose";
import { buildBuckets } from "@/domain/date-range";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import {
  buildMonthlyReview,
  categoryBreakdown,
  incomeByHolding,
  realisedTotals,
  type CategoryRow,
  type IncomeRow,
  type MonthlyReview,
  type RedemptionLine,
  type Totals,
} from "@/domain/reports";
import { computeNetWorthSeries } from "@/domain/series";
import { getBudgetMonth, spendLinesBetween } from "@/modules/budgets/service";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { completeMonthFlows, flowTotalsFor } from "@/modules/dashboard/queries";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import { loadToBase } from "@/modules/fx/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { MonthlyReviewModel, type MonthlyReviewDoc } from "@/modules/reports/model";
import { SipExecutionModel, type SipExecutionDoc } from "@/modules/sip/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";

// docs/05 §15 reports + the monthly review (Phase 11). All amounts in base currency (FX at each
// transaction's date, docs/04 §14). Flows follow docs/04 §4.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
export const parseMonth = (raw: unknown, fallback: string) =>
  typeof raw === "string" && MONTH.test(raw) ? raw : fallback;
export const parseYear = (raw: unknown, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1990 && n <= 2200 ? n : fallback;
};

async function categoryInfo(ctx: Ctx) {
  const docs = await CategoryModel.find({ userId: uid(ctx) }).lean<CategoryDoc[]>();
  return docs.map((c) => ({
    id: String(c._id),
    name: c.name,
    parentId: c.parentId ? String(c.parentId) : null,
  }));
}

async function txnsBetween(
  ctx: Ctx,
  from: string,
  toExclusive: string,
  types: TransactionDoc["type"][],
) {
  return TransactionModel.find({
    userId: uid(ctx),
    status: "posted",
    type: { $in: types },
    date: { $gte: businessDateToUtc(from, ctx.tz), $lt: businessDateToUtc(toExclusive, ctx.tz) },
  })
    .sort({ date: 1, createdAt: 1 })
    .lean<TransactionDoc[]>();
}

// ---------------------------------------------------------------------------- monthly review

/** Builds the review of `month` from the ledger as it is now. */
export async function computeMonthlyReview(ctx: Ctx, month: string): Promise<MonthlyReview> {
  await connectDb();
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const [flows, prevFlows, lines, prevLines, cats, budget, input, sips, txns, toBase] =
    await Promise.all([
      flowTotalsFor(ctx, { from: `${month}-01`, to: monthEnd(month) }),
      flowTotalsFor(ctx, { from: `${prev}-01`, to: monthEnd(prev) }),
      spendLinesBetween(ctx, month, next),
      spendLinesBetween(ctx, prev, month),
      categoryInfo(ctx),
      getBudgetMonth(ctx, month),
      loadSeriesInput(ctx),
      SipExecutionModel.find({
        userId: uid(ctx),
        dueDate: {
          $gte: businessDateToUtc(`${month}-01`, ctx.tz),
          $lt: businessDateToUtc(`${next}-01`, ctx.tz),
        },
      }).lean<SipExecutionDoc[]>(),
      txnsBetween(ctx, `${month}-01`, `${next}-01`, ["redeem", "invest", "transfer"]),
      loadToBase(ctx),
    ]);
  const [start, end] = computeNetWorthSeries(input, [monthEnd(prev), monthEnd(month)]);
  let realised = 0;
  let fees = 0;
  for (const t of txns) {
    const day = utcToBusinessDate(t.date, ctx.tz);
    fees += toBase(t.feeMinor ?? 0, t.currency, day) ?? 0;
    if (t.type === "redeem")
      realised += toBase(t.redemption?.realizedGainMinor ?? 0, t.currency, day) ?? 0;
  }
  const count = (s: string) => sips.filter((e) => e.status === s).length;
  const { getInsights } = await import("@/modules/forecast/service");
  return buildMonthlyReview({
    month,
    currency: ctx.baseCurrency,
    flows: { incomeMinor: flows[0]!.incomeMinor, expenseMinor: flows[0]!.expenseMinor },
    previousFlows: {
      incomeMinor: prevFlows[0]!.incomeMinor,
      expenseMinor: prevFlows[0]!.expenseMinor,
    },
    categories: categoryBreakdown(lines.lines, cats, prevLines.lines),
    budgets: budget.rows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      budgetMinor: r.budgetMinor,
      spentMinor: r.spentMinor,
      status: r.status,
    })),
    netWorthStartMinor: start!.netWorthMinor,
    netWorthEndMinor: end!.netWorthMinor,
    sips: {
      done: count("done"),
      partial: count("partial"),
      missed: count("missed"),
      skipped: count("skipped"),
      investedMinor: sips.reduce((s, e) => s + e.actualTotalMinor, 0),
    },
    realizedGainMinor: realised,
    feesMinor: fees,
    insights: await getInsights(ctx),
  });
}

export interface MonthlySummaryDTO {
  review: MonthlyReview;
  /** Stored by the daily job on the 1st (null: computed now). */
  generatedAt: string | null;
  months: string[];
}

/** The Monthly summary tab: the stored review when there is one, else computed now. */
export async function getMonthlySummary(ctx: Ctx, month: string): Promise<MonthlySummaryDTO> {
  await connectDb();
  const stored = await MonthlyReviewModel.findOne({
    userId: uid(ctx),
    month,
  }).lean<MonthlyReviewDoc>();
  const current = todayOf(ctx).slice(0, 7);
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(current, -i));
  return stored
    ? { review: stored.data, generatedAt: stored.generatedAt.toISOString(), months }
    : { review: await computeMonthlyReview(ctx, month), generatedAt: null, months };
}

/**
 * Daily job (Phase 11): makes sure last month's review exists once the month is over. Idempotent;
 * skipped for users without any ledger data before the month ended.
 */
export async function ensureMonthlyReview(ctx: Ctx, todayKey?: string): Promise<boolean> {
  await connectDb();
  const month = shiftMonth((todayKey ?? todayOf(ctx)).slice(0, 7), -1);
  if (await MonthlyReviewModel.exists({ userId: uid(ctx), month })) return false;
  const any = await TransactionModel.exists({
    userId: uid(ctx),
    status: "posted",
    date: { $lt: businessDateToUtc(`${shiftMonth(month, 1)}-01`, ctx.tz) },
  });
  if (!any) return false;
  const data = await computeMonthlyReview(ctx, month);
  const res = await MonthlyReviewModel.updateOne(
    { userId: uid(ctx), month },
    { $setOnInsert: { userId: uid(ctx), month, generatedAt: new Date(), data } },
    { upsert: true },
  );
  return res.upsertedCount > 0;
}

// ------------------------------------------------------------------------------- other tabs

export async function getIncomeExpense(ctx: Ctx) {
  const points = await completeMonthFlows(ctx, 12);
  return { currency: ctx.baseCurrency, points };
}

export interface CategoriesReport {
  currency: string;
  from: string;
  to: string;
  rows: CategoryRow[];
  totalMinor: number;
}

/** Expense by category for months [from, to] (children rolled up), vs the same-length period before. */
export async function getCategoriesReport(
  ctx: Ctx,
  from: string,
  to: string,
): Promise<CategoriesReport> {
  await connectDb();
  const [a, b] = from <= to ? [from, to] : [to, from];
  const span =
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
    Number(b.slice(5)) -
    Number(a.slice(5)) +
    1;
  const [cur, prev, cats] = await Promise.all([
    spendLinesBetween(ctx, a, shiftMonth(b, 1)),
    spendLinesBetween(ctx, shiftMonth(a, -span), a),
    categoryInfo(ctx),
  ]);
  const rows = categoryBreakdown(cur.lines, cats, prev.lines);
  return {
    currency: ctx.baseCurrency,
    from: a,
    to: b,
    rows,
    totalMinor: rows.reduce((s, r) => s + r.amountMinor, 0),
  };
}

async function holdingNames(ctx: Ctx, ids: (Types.ObjectId | null)[]) {
  const docs = await HoldingModel.find({
    userId: uid(ctx),
    _id: { $in: ids.filter((i): i is Types.ObjectId => i !== null) },
  })
    .select({ name: 1 })
    .lean<Pick<HoldingDoc, "_id" | "name">[]>();
  return new Map(docs.map((h) => [String(h._id), h.name]));
}

export interface RealisedReport {
  currency: string;
  year: number;
  lines: RedemptionLine[];
  totals: Totals;
}

export async function getRealisedGains(ctx: Ctx, year: number): Promise<RealisedReport> {
  await connectDb();
  const [txns, toBase] = await Promise.all([
    txnsBetween(ctx, `${year}-01-01`, `${year + 1}-01-01`, ["redeem"]),
    loadToBase(ctx),
  ]);
  const names = await holdingNames(
    ctx,
    txns.map((t) => t.holdingId),
  );
  const b = (v: number, t: TransactionDoc) =>
    toBase(v, t.currency, utcToBusinessDate(t.date, ctx.tz)) ?? 0;
  const lines = txns.map((t) => ({
    id: String(t._id),
    date: utcToBusinessDate(t.date, ctx.tz),
    holdingId: String(t.holdingId),
    holdingName: names.get(String(t.holdingId)) ?? "Holding",
    amountMinor: b(t.amountMinor, t),
    feeMinor: b(t.feeMinor ?? 0, t),
    taxMinor: b(t.taxMinor ?? 0, t),
    costRemovedMinor: b(t.redemption?.costRemovedMinor ?? 0, t),
    realizedGainMinor: b(t.redemption?.realizedGainMinor ?? 0, t),
  }));
  return { currency: ctx.baseCurrency, year, lines, totals: realisedTotals(lines) };
}

export interface IncomeReport {
  currency: string;
  year: number;
  rows: IncomeRow[];
  totals: { grossMinor: number; taxMinor: number; netMinor: number; reinvestedMinor: number };
}

export async function getInvestmentIncome(ctx: Ctx, year: number): Promise<IncomeReport> {
  await connectDb();
  const [txns, toBase] = await Promise.all([
    txnsBetween(ctx, `${year}-01-01`, `${year + 1}-01-01`, ["investment_income"]),
    loadToBase(ctx),
  ]);
  const names = await holdingNames(
    ctx,
    txns.map((t) => t.holdingId),
  );
  const rows = incomeByHolding(
    txns.map((t) => {
      const day = utcToBusinessDate(t.date, ctx.tz);
      return {
        holdingId: String(t.holdingId),
        holdingName: names.get(String(t.holdingId)) ?? "Holding",
        incomeKind: t.incomeKind ?? "other",
        grossMinor: toBase(t.amountMinor, t.currency, day) ?? 0,
        taxMinor: toBase(t.taxMinor ?? 0, t.currency, day) ?? 0,
        reinvested: Boolean(t.reinvest),
      };
    }),
  );
  const sum = (k: "grossMinor" | "taxMinor" | "netMinor" | "reinvestedMinor") =>
    rows.reduce((s, r) => s + r[k], 0);
  return {
    currency: ctx.baseCurrency,
    year,
    rows,
    totals: {
      grossMinor: sum("grossMinor"),
      taxMinor: sum("taxMinor"),
      netMinor: sum("netMinor"),
      reinvestedMinor: sum("reinvestedMinor"),
    },
  };
}

export interface NetWorthRow {
  month: string;
  date: string;
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  investedMinor: number;
  holdingsValueMinor: number;
  cashMinor: number;
}

/** Month-end closing values from the first month with data to today (docs/04 §22: stocks). */
export async function getNetWorthHistory(
  ctx: Ctx,
): Promise<{ currency: string; rows: NetWorthRow[] }> {
  await connectDb();
  const input = await loadSeriesInput(ctx);
  const today = todayOf(ctx);
  if (!input.earliestKey) return { currency: ctx.baseCurrency, rows: [] };
  const ends = buildBuckets({ from: input.earliestKey, to: today }, "month").map((b) =>
    b.end > today ? today : b.end,
  );
  const rows = computeNetWorthSeries(input, ends).map((p) => ({
    month: p.date.slice(0, 7),
    date: p.date,
    netWorthMinor: p.netWorthMinor,
    assetsMinor: p.assetsMinor,
    liabilitiesMinor: p.liabilitiesMinor,
    investedMinor: p.investedMinor,
    holdingsValueMinor: p.holdingsValueMinor,
    cashMinor: p.cashMinor,
  }));
  return { currency: ctx.baseCurrency, rows };
}
