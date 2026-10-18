import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { fdValue } from "@/domain/fd";
import {
  goalCurrent,
  goalStatus,
  monthsLeft,
  requiredMonthly,
  type GoalStatus,
} from "@/domain/goals";
import { effectOn } from "@/domain/ledger";
import { dateKey } from "@/modules/accounts/schemas";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { loadToBase } from "@/modules/fx/service";
import { GoalModel, type GoalDoc } from "@/modules/goals/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { fdTerms } from "@/server/ledger/holding-events";
import { toLedgerTxn } from "@/server/ledger/to-ledger-txn";

// docs/04 §13 — goals: current = Σ linked value × share (base currency, today); required monthly
// from the target date and expected return; on track when required ≤ 110% of the average net
// monthly contribution to the linked items over the last 3 complete months (owner-approved:
// accounts = net balance change, holdings = invested − redeemed; market growth is not a contribution).

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
export const goalInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(60),
    targetMinor: z
      .number({ error: "Enter a target" })
      .int()
      .positive("Above zero")
      .max(Number.MAX_SAFE_INTEGER),
    targetDate: dateKey,
    priority: z.number().int().min(1).max(5).default(3),
    icon: z.string().trim().max(8).nullish(),
    notes: z.string().trim().max(500).nullish(),
    expectedReturnBp: z.number().int().min(0).max(5_000).default(0),
    links: z
      .array(
        z
          .object({
            kind: z.enum(["holding", "account"]),
            refId: objectId,
            shareBp: z.number().int().min(1, "Above 0%").max(10_000),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
  .refine((v) => new Set(v.links.map((l) => l.refId)).size === v.links.length, {
    path: ["links"],
    message: "Link each item once",
  });
export type GoalInput = z.input<typeof goalInputSchema>;

export interface GoalDTO {
  id: string;
  name: string;
  icon: string | null;
  notes: string | null;
  priority: number;
  targetMinor: number;
  targetDate: string;
  expectedReturnBp: number;
  currency: string;
  currentMinor: number;
  progressBp: number;
  shortfallMinor: number;
  monthsLeft: number;
  requiredMonthlyMinor: number;
  avgMonthlyContributionMinor: number;
  status: GoalStatus;
  archived: boolean;
  links: {
    kind: "holding" | "account";
    refId: string;
    name: string;
    shareBp: number;
    valueMinor: number;
    countedMinor: number;
  }[];
}

export interface GoalsOverviewDTO {
  currency: string;
  todayKey: string;
  goals: GoalDTO[];
  options: { kind: "holding" | "account"; id: string; name: string; usedBp: number }[];
}

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);

/** First day of the month `offset` months before today's month. */
function monthStart(today: string, offset: number): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) - offset;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

interface Values {
  value: Map<string, number>;
  contribution: Map<string, number>;
  names: Map<string, string>;
}

/** Today's base value and 3-month average monthly contribution per account / holding. */
async function linkValues(
  ctx: Ctx,
  accounts: AccountDoc[],
  holdings: HoldingDoc[],
): Promise<Values> {
  const today = todayOf(ctx);
  const toBase = await loadToBase(ctx);
  const value = new Map<string, number>();
  const names = new Map<string, string>();
  for (const a of accounts) {
    value.set(String(a._id), toBase(a.balanceMinor, a.currency, today) ?? 0);
    names.set(String(a._id), a.name);
  }
  for (const h of holdings) {
    const terms = fdTerms(h, ctx.tz);
    const v = terms ? fdValue(terms, today) : h.currentValueMinor;
    value.set(String(h._id), toBase(v, h.currency, today) ?? 0);
    names.set(String(h._id), h.name);
  }
  const from = businessDateToUtc(monthStart(today, 3), ctx.tz);
  const to = businessDateToUtc(monthStart(today, 0), ctx.tz);
  const accountIds = accounts.map((a) => a._id);
  const holdingIds = holdings.map((h) => h._id);
  const txns = await TransactionModel.find({
    userId: uid(ctx),
    status: "posted",
    date: { $gte: from, $lt: to },
    $or: [
      { fromAccountId: { $in: accountIds } },
      { toAccountId: { $in: accountIds } },
      { holdingId: { $in: holdingIds } },
    ],
  }).lean<TransactionDoc[]>();
  const contribution = new Map<string, number>();
  const bump = (id: string, v: number) => contribution.set(id, (contribution.get(id) ?? 0) + v);
  const accountCcy = new Map(accounts.map((a) => [String(a._id), a.currency]));
  for (const t of txns) {
    const day = utcToBusinessDate(t.date, ctx.tz);
    const lt = toLedgerTxn(t);
    for (const id of [t.fromAccountId, t.toAccountId]) {
      if (!id || !accountCcy.has(String(id))) continue;
      bump(String(id), toBase(effectOn(lt, String(id)), accountCcy.get(String(id))!, day) ?? 0);
    }
    if (t.holdingId && holdingIds.some((h) => h.equals(t.holdingId!))) {
      const v =
        t.type === "invest" ? t.amountMinor + t.feeMinor : t.type === "redeem" ? -t.amountMinor : 0;
      if (v) bump(String(t.holdingId), toBase(v, t.currency, day) ?? 0);
    }
  }
  for (const [k, v] of contribution) contribution.set(k, Math.round(v / 3));
  return { value, contribution, names };
}

function toDTO(ctx: Ctx, g: GoalDoc, v: Values): GoalDTO {
  const today = todayOf(ctx);
  const links = g.links.map((l) => {
    const valueMinor = v.value.get(String(l.refId)) ?? 0;
    return {
      kind: l.kind,
      refId: String(l.refId),
      name: v.names.get(String(l.refId)) ?? "Removed item",
      shareBp: l.shareBp,
      valueMinor,
      countedMinor: Math.round((Math.max(0, valueMinor) * l.shareBp) / 10_000),
    };
  });
  const current = goalCurrent(links.map((l) => ({ valueMinor: l.valueMinor, shareBp: l.shareBp })));
  const months = monthsLeft(today, g.targetDate);
  const required = requiredMonthly(g.targetMinor, current, months, g.expectedReturnBp);
  const contribution = g.links.reduce(
    (s, l) => s + Math.round(((v.contribution.get(String(l.refId)) ?? 0) * l.shareBp) / 10_000),
    0,
  );
  return {
    id: String(g._id),
    name: g.name,
    icon: g.icon,
    notes: g.notes,
    priority: g.priority,
    targetMinor: g.targetMinor,
    targetDate: g.targetDate,
    expectedReturnBp: g.expectedReturnBp,
    currency: ctx.baseCurrency,
    currentMinor: current,
    progressBp: Math.min(10_000, Math.round((current * 10_000) / g.targetMinor)),
    shortfallMinor: Math.max(0, g.targetMinor - current),
    monthsLeft: months,
    requiredMonthlyMinor: required,
    avgMonthlyContributionMinor: contribution,
    status: goalStatus({
      targetMinor: g.targetMinor,
      currentMinor: current,
      months,
      requiredMonthlyMinor: required,
      avgMonthlyContributionMinor: contribution,
    }),
    archived: g.status === "archived",
    links,
  };
}

export async function listGoals(ctx: Ctx): Promise<GoalsOverviewDTO> {
  await connectDb();
  const userId = uid(ctx);
  const [goals, accounts, holdings] = await Promise.all([
    GoalModel.find({ userId }).sort({ status: 1, priority: 1, targetDate: 1 }).lean<GoalDoc[]>(),
    AccountModel.find({ userId, archivedAt: null }).sort({ name: 1 }).lean<AccountDoc[]>(),
    HoldingModel.find({ userId, status: "active" }).sort({ name: 1 }).lean<HoldingDoc[]>(),
  ]);
  const v = await linkValues(ctx, accounts, holdings);
  const used = new Map<string, number>();
  for (const g of goals) {
    if (g.status === "archived") continue;
    for (const l of g.links)
      used.set(String(l.refId), (used.get(String(l.refId)) ?? 0) + l.shareBp);
  }
  return {
    currency: ctx.baseCurrency,
    todayKey: todayOf(ctx),
    goals: goals.map((g) => toDTO(ctx, g, v)),
    options: [
      ...accounts
        .filter((a) => !["credit_card", "loan", "payable"].includes(a.type))
        .map((a) => ({
          kind: "account" as const,
          id: String(a._id),
          name: a.name,
          usedBp: used.get(String(a._id)) ?? 0,
        })),
      ...holdings.map((h) => ({
        kind: "holding" as const,
        id: String(h._id),
        name: h.name,
        usedBp: used.get(String(h._id)) ?? 0,
      })),
    ],
  };
}

async function saveGoal(ctx: Ctx, id: string | null, input: unknown): Promise<{ id: string }> {
  const data = parseInput(goalInputSchema, input);
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    for (const [i, l] of data.links.entries()) {
      const model = l.kind === "account" ? AccountModel : HoldingModel;
      const exists = await (model as typeof AccountModel)
        .exists({ _id: toObjectId(l.refId, "Item"), userId })
        .session(session);
      if (!exists)
        throw new AppError("VALIDATION", "Linked item not found", {
          [`links.${i}.refId`]: ["Not found"],
        });
    }
    // One item's shares across active goals cannot exceed 100% (owner-approved): no double counting.
    const others = await GoalModel.find({
      userId,
      status: { $ne: "archived" },
      ...(id ? { _id: { $ne: toObjectId(id, "Goal") } } : {}),
    })
      .session(session)
      .lean<GoalDoc[]>();
    for (const [i, l] of data.links.entries()) {
      const used = others
        .flatMap((g) => g.links)
        .filter((x) => String(x.refId) === l.refId)
        .reduce((s, x) => s + x.shareBp, 0);
      if (used + l.shareBp > 10_000) {
        throw new AppError(
          "VALIDATION",
          `Only ${(10_000 - used) / 100}% of this item is still free for goals`,
          {
            [`links.${i}.shareBp`]: [`At most ${(10_000 - used) / 100}%`],
          },
        );
      }
    }
    const fields = {
      name: data.name,
      targetMinor: data.targetMinor,
      targetDate: data.targetDate,
      priority: data.priority,
      icon: data.icon ?? null,
      notes: data.notes ?? null,
      expectedReturnBp: data.expectedReturnBp,
      links: data.links.map((l) => ({
        kind: l.kind,
        refId: new Types.ObjectId(l.refId),
        shareBp: l.shareBp,
      })),
    };
    if (id) {
      const res = await GoalModel.updateOne(
        { _id: toObjectId(id, "Goal"), userId },
        { $set: fields },
        { session },
      );
      if (!res.matchedCount) throw new AppError("NOT_FOUND", "Goal not found");
      return { id };
    }
    const [doc] = await GoalModel.create([{ ...fields, userId, status: "active" }], { session });
    return { id: String(doc!._id) };
  });
}

export const createGoal = (ctx: Ctx, input: unknown) => saveGoal(ctx, null, input);
export const updateGoal = (ctx: Ctx, id: string, input: unknown) => saveGoal(ctx, id, input);

export async function setGoalArchived(
  ctx: Ctx,
  id: string,
  archived: boolean,
): Promise<{ id: string }> {
  await connectDb();
  const res = await GoalModel.updateOne(
    { _id: toObjectId(id, "Goal"), userId: uid(ctx) },
    { $set: { status: archived ? "archived" : "active" } },
  );
  if (!res.matchedCount) throw new AppError("NOT_FOUND", "Goal not found");
  return { id };
}

/** Goals are plans, not ledger records: deleting one removes only the plan. */
export async function deleteGoal(ctx: Ctx, id: string): Promise<{ id: string }> {
  await connectDb();
  await GoalModel.deleteOne({ _id: toObjectId(id, "Goal"), userId: uid(ctx) });
  return { id };
}
