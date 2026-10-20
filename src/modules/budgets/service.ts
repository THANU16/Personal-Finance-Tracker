import "server-only";
import { Types } from "mongoose";
import {
  budgetActuals,
  budgetStatus,
  budgetTotal,
  budgetedSpendTotal,
  copyForward,
  previousMonth,
  unbudgeted,
  type BudgetStatus,
  type SpendLine,
} from "@/domain/budgets";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { BudgetModel, type BudgetDoc } from "@/modules/budgets/model";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { loadToBase } from "@/modules/fx/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { z } from "zod";

// docs/04 §13 — monthly budgets per expense category (base currency). Actual = expense in the
// category and its children for the month (splits per line), plus transfer fees ("Bank fees") and
// loan interest ("Loan interest"), the same definition as cashflow (§4).

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose a category");
export const setBudgetSchema = z
  .object({
    month,
    categoryId: objectId,
    amountMinor: z
      .number({ error: "Enter an amount" })
      .int("Whole amount")
      .positive("Above zero")
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const removeBudgetSchema = z.object({ month, categoryId: objectId }).strict();
export const monthSchema = month;

export interface BudgetRowDTO {
  categoryId: string;
  name: string;
  parentName: string | null;
  icon: string | null;
  budgetMinor: number;
  spentMinor: number;
  remainingMinor: number;
  usedBp: number;
  status: BudgetStatus;
}

export interface BudgetMonthDTO {
  month: string;
  currency: string;
  rows: BudgetRowDTO[];
  unbudgeted: { categoryId: string; name: string; spentMinor: number }[];
  unbudgetedTotalMinor: number;
  totals: { budgetMinor: number; spentMinor: number; usedBp: number; status: BudgetStatus };
  /** All expense spending in the month (budgeted + unbudgeted). */
  monthSpentMinor: number;
  fxMissing: number;
  categories: { id: string; label: string }[];
  previousMonthBudgets: number;
}

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const nextMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
};
export const currentMonth = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz).slice(0, 7);

/** Categorised expense lines of a month in base currency (user timezone). */
export async function spendLines(
  ctx: Ctx,
  m: string,
): Promise<{ lines: SpendLine[]; fxMissing: number }> {
  return spendLinesBetween(ctx, m, nextMonth(m));
}

/** Categorised expense lines from month `fromMonth` up to (not including) `toMonth`, base currency. */
export async function spendLinesBetween(
  ctx: Ctx,
  fromMonth: string,
  toMonth: string,
): Promise<{ lines: SpendLine[]; fxMissing: number }> {
  const from = businessDateToUtc(`${fromMonth}-01`, ctx.tz);
  const to = businessDateToUtc(`${toMonth}-01`, ctx.tz);
  const [txns, toBase] = await Promise.all([
    TransactionModel.find({
      userId: uid(ctx),
      status: "posted",
      date: { $gte: from, $lt: to },
      $or: [
        { type: "expense" },
        { type: "transfer", feeMinor: { $gt: 0 } },
        { type: "debt_payment", interestMinor: { $gt: 0 } },
      ],
    }).lean<TransactionDoc[]>(),
    loadToBase(ctx),
  ]);
  const lines: SpendLine[] = [];
  let fxMissing = 0;
  for (const t of txns) {
    const day = utcToBusinessDate(t.date, ctx.tz);
    const raw: SpendLine[] =
      t.type === "expense"
        ? t.splits.length
          ? t.splits.map((s) => ({ categoryId: String(s.categoryId), amountMinor: s.amountMinor }))
          : [{ categoryId: String(t.categoryId), amountMinor: t.amountMinor }]
        : t.type === "transfer"
          ? [{ categoryId: String(t.categoryId), amountMinor: t.feeMinor }]
          : [{ categoryId: String(t.categoryId), amountMinor: t.interestMinor ?? 0 }];
    for (const l of raw) {
      const v = toBase(l.amountMinor, t.currency, day);
      if (v === null) {
        fxMissing += 1;
        continue;
      }
      lines.push({ categoryId: l.categoryId, amountMinor: v });
    }
  }
  return { lines, fxMissing };
}

export async function getBudgetMonth(ctx: Ctx, m: string): Promise<BudgetMonthDTO> {
  const mm = parseInput(monthSchema, m);
  await connectDb();
  const userId = uid(ctx);
  const [budgets, categories, spend, prevCount] = await Promise.all([
    BudgetModel.find({ userId, month: mm }).lean<BudgetDoc[]>(),
    CategoryModel.find({ userId, kind: "expense" }).lean<CategoryDoc[]>(),
    spendLines(ctx, mm),
    BudgetModel.countDocuments({ userId, month: previousMonth(mm) }),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const parentOf = new Map(
    categories.map((c) => [String(c._id), c.parentId ? String(c.parentId) : null]),
  );
  const lines = budgets.map((b) => ({
    categoryId: String(b.categoryId),
    amountMinor: b.amountMinor,
  }));
  const actuals = budgetActuals(spend.lines, parentOf, lines);
  const ids = new Set(lines.map((b) => b.categoryId));
  const label = (id: string) => {
    const c = byId.get(id);
    const p = c?.parentId ? byId.get(String(c.parentId)) : undefined;
    return { name: c?.name ?? "Unknown", parentName: p?.name ?? null, icon: c?.icon ?? null };
  };
  const rows: BudgetRowDTO[] = lines
    .map((b) => {
      const spent = actuals.get(b.categoryId) ?? 0;
      return {
        categoryId: b.categoryId,
        ...label(b.categoryId),
        budgetMinor: b.amountMinor,
        spentMinor: spent,
        remainingMinor: b.amountMinor - spent,
        ...budgetStatus(spent, b.amountMinor),
      };
    })
    .sort(
      (a, z) =>
        (a.parentName ?? a.name).localeCompare(z.parentName ?? z.name) ||
        (a.parentName ? 1 : -1) - (z.parentName ? 1 : -1) ||
        a.name.localeCompare(z.name),
    );
  const un = [...unbudgeted(spend.lines, parentOf, ids)]
    .map(([categoryId, spentMinor]) => {
      const l = label(categoryId);
      return {
        categoryId,
        name: l.parentName ? `${l.parentName} › ${l.name}` : l.name,
        spentMinor,
      };
    })
    .sort((a, z) => z.spentMinor - a.spentMinor);
  const totalBudget = budgetTotal(lines, parentOf);
  const totalSpent = budgetedSpendTotal(spend.lines, parentOf, ids);
  return {
    month: mm,
    currency: ctx.baseCurrency,
    rows,
    unbudgeted: un,
    unbudgetedTotalMinor: un.reduce((s, u) => s + u.spentMinor, 0),
    totals: {
      budgetMinor: totalBudget,
      spentMinor: totalSpent,
      ...budgetStatus(totalSpent, totalBudget),
    },
    monthSpentMinor: spend.lines.reduce((s, l) => s + l.amountMinor, 0),
    fxMissing: spend.fxMissing,
    categories: categories
      .filter((c) => !c.archivedAt)
      .map((c) => {
        const l = label(String(c._id));
        return { id: String(c._id), label: l.parentName ? `${l.parentName} › ${l.name}` : l.name };
      })
      .sort((a, z) => a.label.localeCompare(z.label)),
    previousMonthBudgets: prevCount,
  };
}

export async function setBudget(ctx: Ctx, input: unknown): Promise<{ saved: true }> {
  const data = parseInput(setBudgetSchema, input);
  await connectDb();
  const userId = uid(ctx);
  const c = await CategoryModel.findOne({
    _id: toObjectId(data.categoryId, "Category"),
    userId,
  }).lean<CategoryDoc>();
  if (!c || c.kind !== "expense" || c.archivedAt) {
    throw new AppError("VALIDATION", "Choose an active expense category", {
      categoryId: ["Expense category"],
    });
  }
  await BudgetModel.updateOne(
    { userId, month: data.month, categoryId: c._id },
    { $set: { amountMinor: data.amountMinor }, $setOnInsert: { rollover: false } },
    { upsert: true, runValidators: true },
  );
  return { saved: true };
}

export async function removeBudget(ctx: Ctx, input: unknown): Promise<{ removed: true }> {
  const data = parseInput(removeBudgetSchema, input);
  await connectDb();
  await BudgetModel.deleteOne({
    userId: uid(ctx),
    month: data.month,
    categoryId: toObjectId(data.categoryId, "Category"),
  });
  return { removed: true };
}

/** "Copy last month": adds last month's budgets for categories without one this month. */
export async function copyLastMonth(ctx: Ctx, m: string): Promise<{ copied: number }> {
  const mm = parseInput(monthSchema, m);
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    // Sequential: parallel operations cannot open a DB transaction.
    const prev = await BudgetModel.find({ userId, month: previousMonth(mm) })
      .session(session)
      .lean<BudgetDoc[]>();
    const cur = await BudgetModel.find({ userId, month: mm }).session(session).lean<BudgetDoc[]>();
    const toAdd = copyForward(
      prev.map((b) => ({ categoryId: String(b.categoryId), amountMinor: b.amountMinor })),
      cur.map((b) => ({ categoryId: String(b.categoryId), amountMinor: b.amountMinor })),
    );
    if (toAdd.length) {
      await BudgetModel.insertMany(
        toAdd.map((b) => ({
          userId,
          month: mm,
          categoryId: new Types.ObjectId(b.categoryId),
          amountMinor: b.amountMinor,
        })),
        { session },
      );
    }
    return { copied: toAdd.length };
  });
}

/** Budgets at ≥ 80% this month (dashboard Attention). */
export async function budgetsNeedingAttention(ctx: Ctx): Promise<{ warn: number; over: number }> {
  const m = await getBudgetMonth(ctx, currentMonth(ctx));
  return {
    warn: m.rows.filter((r) => r.status === "warn").length,
    over: m.rows.filter((r) => r.status === "over").length,
  };
}
