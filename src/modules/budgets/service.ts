import "server-only";
import { Types, type ClientSession } from "mongoose";
import {
  budgetActuals,
  budgetStatus,
  budgetTotal,
  budgetedSpendTotal,
  copyForward,
  effectiveBudgets,
  previousMonth,
  ruleCovers,
  unbudgeted,
  type BudgetStatus,
  type EffectiveBudget,
  type SpendLine,
} from "@/domain/budgets";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import {
  BudgetModel,
  BudgetRuleModel,
  type BudgetDoc,
  type BudgetRuleDoc,
} from "@/modules/budgets/model";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { loadToBase } from "@/modules/fx/service";
import { TransactionModel } from "@/modules/transactions/model";
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
// Owner request: a budget can repeat every month (budgetRules) from a month on, optionally until an
// end month; a month's own row overrides it (or skips it) for that month.

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
    /** "month" = this month only; "repeat" = every month from `month` (until `untilMonth`). */
    applies: z.enum(["month", "repeat"]).default("month"),
    untilMonth: month.nullish(),
  })
  .strict()
  .refine((v) => !v.untilMonth || v.applies === "repeat", {
    path: ["untilMonth"],
    message: "Only a repeating budget has an end month",
  })
  .refine((v) => !v.untilMonth || v.untilMonth >= v.month, {
    path: ["untilMonth"],
    message: "Pick this month or later",
  });
export const removeBudgetSchema = z
  .object({
    month,
    categoryId: objectId,
    /** "month" = only this month; "onwards" = this and later months. */
    scope: z.enum(["month", "onwards"]).default("month"),
  })
  .strict();
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
  /** The repeating budget this month's amount comes from; null = this month only. */
  repeat: { fromMonth: string; untilMonth: string | null } | null;
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

/** The budgets that apply in `m` (own rows win; else the covering repeating budget). */
async function loadEffective(
  ctx: Ctx,
  m: string,
  session?: ClientSession,
): Promise<EffectiveBudget[]> {
  const userId = uid(ctx);
  const rowsQ = BudgetModel.find({ userId, month: m });
  const rulesQ = BudgetRuleModel.find({
    userId,
    fromMonth: { $lte: m },
    $or: [{ untilMonth: null }, { untilMonth: { $gte: m } }],
  });
  if (session) {
    rowsQ.session(session);
    rulesQ.session(session);
  }
  // Sequential inside a transaction (parallel operations cannot share one).
  const rows = await rowsQ.lean<BudgetDoc[]>();
  const rules = await rulesQ.lean<BudgetRuleDoc[]>();
  return effectiveBudgets(
    m,
    rows.map((r) => ({
      categoryId: String(r.categoryId),
      amountMinor: r.amountMinor,
      skip: Boolean(r.skip),
    })),
    rules.map((r) => ({
      categoryId: String(r.categoryId),
      amountMinor: r.amountMinor,
      fromMonth: r.fromMonth,
      untilMonth: r.untilMonth ?? null,
    })),
  );
}

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
  // Phase 12 perf: lines summed per (business day, currency, category) in MongoDB — the day key is
  // computed there in the user's timezone, so only a few hundred rows reach the FX conversion.
  const [groups, toBase] = await Promise.all([
    TransactionModel.aggregate<{ _id: { day: string; currency: string; c: unknown }; a: number }>([
      {
        $match: {
          userId: uid(ctx),
          status: "posted",
          date: { $gte: from, $lt: to },
          $or: [
            { type: "expense" },
            { type: "transfer", feeMinor: { $gt: 0 } },
            { type: "debt_payment", interestMinor: { $gt: 0 } },
          ],
        },
      },
      {
        $project: {
          currency: 1,
          day: { $dateToString: { date: "$date", format: "%Y-%m-%d", timezone: ctx.tz } },
          lines: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $eq: ["$type", "expense"] },
                      { $gt: [{ $size: { $ifNull: ["$splits", []] } }, 0] },
                    ],
                  },
                  then: {
                    $map: {
                      input: "$splits",
                      as: "s",
                      in: { c: "$$s.categoryId", a: "$$s.amountMinor" },
                    },
                  },
                },
                {
                  case: { $eq: ["$type", "expense"] },
                  then: [{ c: "$categoryId", a: "$amountMinor" }],
                },
                {
                  case: { $eq: ["$type", "transfer"] },
                  then: [{ c: "$categoryId", a: "$feeMinor" }],
                },
              ],
              default: [{ c: "$categoryId", a: { $ifNull: ["$interestMinor", 0] } }],
            },
          },
        },
      },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { day: "$day", currency: "$currency", c: "$lines.c" },
          a: { $sum: "$lines.a" },
        },
      },
    ]),
    loadToBase(ctx),
  ]);
  const lines: SpendLine[] = [];
  let fxMissing = 0;
  for (const g of groups) {
    const v = toBase(g.a, g._id.currency, g._id.day);
    if (v === null) {
      fxMissing += 1;
      continue;
    }
    lines.push({ categoryId: String(g._id.c), amountMinor: v });
  }
  return { lines, fxMissing };
}

export async function getBudgetMonth(ctx: Ctx, m: string): Promise<BudgetMonthDTO> {
  const mm = parseInput(monthSchema, m);
  await connectDb();
  const userId = uid(ctx);
  const [budgets, categories, spend, prev] = await Promise.all([
    loadEffective(ctx, mm),
    CategoryModel.find({ userId, kind: "expense" }).lean<CategoryDoc[]>(),
    spendLines(ctx, mm),
    loadEffective(ctx, previousMonth(mm)),
  ]);
  const repeatOf = new Map(budgets.map((b) => [b.categoryId, b.repeat]));
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
        repeat: repeatOf.get(b.categoryId) ?? null,
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
    previousMonthBudgets: prev.length,
  };
}

/**
 * Sets a category's budget. "month": this month only (overrides any repeating budget). "repeat":
 * every month from `month` on (until `untilMonth`): this month's own row is dropped so the new
 * amount applies now, and later repeating budgets inside the new range are replaced. Earlier months
 * keep their amounts.
 */
export async function setBudget(ctx: Ctx, input: unknown): Promise<{ saved: true }> {
  const data = parseInput(setBudgetSchema, input);
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    const c = await CategoryModel.findOne({
      _id: toObjectId(data.categoryId, "Category"),
      userId,
    })
      .session(session)
      .lean<CategoryDoc>();
    if (!c || c.kind !== "expense" || c.archivedAt) {
      throw new AppError("VALIDATION", "Choose an active expense category", {
        categoryId: ["Expense category"],
      });
    }
    if (data.applies === "month") {
      await BudgetModel.updateOne(
        { userId, month: data.month, categoryId: c._id },
        { $set: { amountMinor: data.amountMinor, skip: false }, $setOnInsert: { rollover: false } },
        { upsert: true, runValidators: true, session },
      );
      return { saved: true as const };
    }
    const until = data.untilMonth ?? null;
    await BudgetRuleModel.deleteMany(
      {
        userId,
        categoryId: c._id,
        fromMonth: until ? { $gt: data.month, $lte: until } : { $gt: data.month },
      },
      { session },
    );
    await BudgetRuleModel.updateOne(
      { userId, categoryId: c._id, fromMonth: data.month },
      { $set: { amountMinor: data.amountMinor, untilMonth: until } },
      { upsert: true, runValidators: true, session },
    );
    await BudgetModel.deleteOne({ userId, month: data.month, categoryId: c._id }, { session });
    return { saved: true as const };
  });
}

/**
 * "month": no budget this month (a repeating budget is skipped for it; a one-month budget is
 * removed). "onwards": this and later months — repeating budgets end the month before (or are
 * removed if they start now or later) and later one-month rows go too. Earlier months keep theirs.
 */
export async function removeBudget(ctx: Ctx, input: unknown): Promise<{ removed: true }> {
  const data = parseInput(removeBudgetSchema, input);
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    const categoryId = toObjectId(data.categoryId, "Category");
    const rules = await BudgetRuleModel.find({ userId, categoryId })
      .session(session)
      .lean<BudgetRuleDoc[]>();
    if (data.scope === "month") {
      if (
        rules.some((r) =>
          ruleCovers({ fromMonth: r.fromMonth, untilMonth: r.untilMonth ?? null }, data.month),
        )
      ) {
        await BudgetModel.updateOne(
          { userId, month: data.month, categoryId },
          { $set: { amountMinor: 0, skip: true }, $setOnInsert: { rollover: false } },
          { upsert: true, runValidators: true, session },
        );
      } else {
        await BudgetModel.deleteOne({ userId, month: data.month, categoryId }, { session });
      }
      return { removed: true as const };
    }
    const before = previousMonth(data.month);
    for (const r of rules) {
      if (r.fromMonth >= data.month) {
        await BudgetRuleModel.deleteOne({ _id: r._id, userId }, { session });
      } else if (r.untilMonth === null || r.untilMonth >= data.month) {
        await BudgetRuleModel.updateOne(
          { _id: r._id, userId },
          { $set: { untilMonth: before } },
          { session },
        );
      }
    }
    await BudgetModel.deleteMany({ userId, categoryId, month: { $gte: data.month } }, { session });
    return { removed: true as const };
  });
}

/** "Copy last month": adds last month's budgets for categories without one this month. */
export async function copyLastMonth(ctx: Ctx, m: string): Promise<{ copied: number }> {
  const mm = parseInput(monthSchema, m);
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    // Sequential: parallel operations cannot open a DB transaction.
    const prev = await loadEffective(ctx, previousMonth(mm), session);
    const cur = await loadEffective(ctx, mm, session);
    const toAdd = copyForward(prev, cur);
    for (const b of toAdd) {
      await BudgetModel.updateOne(
        { userId, month: mm, categoryId: new Types.ObjectId(b.categoryId) },
        { $set: { amountMinor: b.amountMinor, skip: false }, $setOnInsert: { rollover: false } },
        { upsert: true, runValidators: true, session },
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
