import "server-only";
import { Types, type ClientSession } from "mongoose";
import { z } from "zod";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { fdValue } from "@/domain/fd";
import {
  RECURRENCE_UNITS,
  describeRecurrence,
  dueDateOfCycle,
  goalCurrent,
  goalStatus,
  monthsLeft,
  requiredMonthly,
  type GoalStatus,
  type Recurrence,
} from "@/domain/goals";
import { effectOn } from "@/domain/ledger";
import { dateKey } from "@/modules/accounts/schemas";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { loadToBase } from "@/modules/fx/service";
import { GoalModel, type GoalCycle, type GoalDoc, type GoalKind } from "@/modules/goals/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
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
    /** One-time: the target date. Repeating: the (next) due date. */
    targetDate: dateKey,
    kind: z.enum(["one_time", "recurring"]).default("one_time"),
    /** Repeating goals: every N months / years. */
    recurrence: z
      .object({
        every: z.number().int().min(1, "At least 1").max(120, "At most 120"),
        unit: z.enum(RECURRENCE_UNITS),
      })
      .strict()
      .nullish(),
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
  })
  .refine((v) => v.kind === "one_time" || Boolean(v.recurrence), {
    path: ["recurrence"],
    message: "Choose how often it repeats",
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
  kind: GoalKind;
  /** Repeating goals; null for one-time goals. */
  recurrence: { every: number; unit: Recurrence["unit"]; label: string } | null;
  cycleNo: number;
  /** Closed cycles, newest first. */
  cycles: GoalCycle[];
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
  /** Goal savings accounts kept for this goal: they count in full (owner request). */
  accounts: {
    id: string;
    name: string;
    currency: string;
    balanceMinor: number;
    /** Base currency, never below 0. */
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

function toDTO(ctx: Ctx, g: GoalDoc, v: Values, reserved: AccountDoc[] = []): GoalDTO {
  const today = todayOf(ctx);
  const accounts = reserved.map((a) => ({
    id: String(a._id),
    name: a.name,
    currency: a.currency,
    balanceMinor: a.balanceMinor,
    countedMinor: Math.max(0, v.value.get(String(a._id)) ?? 0),
  }));
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
  // Goal savings accounts count in full next to the linked shares.
  const current =
    goalCurrent(links.map((l) => ({ valueMinor: l.valueMinor, shareBp: l.shareBp }))) +
    accounts.reduce((s, a) => s + a.countedMinor, 0);
  const months = monthsLeft(today, g.targetDate);
  const required = requiredMonthly(g.targetMinor, current, months, g.expectedReturnBp);
  const contribution =
    g.links.reduce(
      (s, l) => s + Math.round(((v.contribution.get(String(l.refId)) ?? 0) * l.shareBp) / 10_000),
      0,
    ) + accounts.reduce((s, a) => s + (v.contribution.get(a.id) ?? 0), 0);
  return {
    id: String(g._id),
    name: g.name,
    icon: g.icon,
    notes: g.notes,
    priority: g.priority,
    targetMinor: g.targetMinor,
    targetDate: g.targetDate,
    kind: g.kind ?? "one_time",
    recurrence:
      g.kind === "recurring" && g.recurrence
        ? {
            every: g.recurrence.every,
            unit: g.recurrence.unit,
            label: describeRecurrence(g.recurrence),
          }
        : null,
    cycleNo: g.cycleNo ?? 0,
    cycles: [...(g.cycles ?? [])].reverse(),
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
    accounts,
  };
}

/** Goal savings accounts per goal id. */
function reservedByGoal(accounts: readonly AccountDoc[]): Map<string, AccountDoc[]> {
  const out = new Map<string, AccountDoc[]>();
  for (const a of accounts) {
    if (!a.goalId) continue;
    const key = String(a.goalId);
    out.set(key, [...(out.get(key) ?? []), a]);
  }
  return out;
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
  const reserved = reservedByGoal(accounts);
  const used = new Map<string, number>();
  for (const g of goals) {
    if (g.status === "archived") continue;
    for (const l of g.links)
      used.set(String(l.refId), (used.get(String(l.refId)) ?? 0) + l.shareBp);
  }
  return {
    currency: ctx.baseCurrency,
    todayKey: todayOf(ctx),
    goals: goals.map((g) => toDTO(ctx, g, v, reserved.get(String(g._id)) ?? [])),
    options: [
      ...accounts
        // A goal savings account already counts in full for its goal.
        .filter((a) => !["credit_card", "loan", "payable"].includes(a.type) && !a.goalId)
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
      if (
        l.kind === "account" &&
        (await AccountModel.exists({
          _id: toObjectId(l.refId, "Item"),
          userId,
          goalId: { $ne: null },
        }).session(session))
      ) {
        const message = "This account is kept for a goal and counts in full there";
        throw new AppError("VALIDATION", message, { [`links.${i}.refId`]: [message] });
      }
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
    const existing = id
      ? await GoalModel.findOne({ _id: toObjectId(id, "Goal"), userId })
          .session(session)
          .lean<GoalDoc>()
      : null;
    if (id && !existing) throw new AppError("NOT_FOUND", "Goal not found");
    const fields = {
      name: data.name,
      targetMinor: data.targetMinor,
      targetDate: data.targetDate,
      kind: data.kind,
      recurrence: nextRecurrence(existing, data),
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

/**
 * Repeating schedule after a save. The due date entered is the current cycle's due date: a new
 * repeating goal (or a goal switched to repeating) anchors there; an edit that changes the date or
 * the period re-anchors at the current cycle; otherwise the anchor is kept (no drift).
 */
function nextRecurrence(
  existing: GoalDoc | null,
  data: z.infer<typeof goalInputSchema>,
): Recurrence | null {
  if (data.kind !== "recurring" || !data.recurrence) return null;
  const cycleNo = existing?.cycleNo ?? 0;
  const old = existing?.kind === "recurring" ? existing.recurrence : null;
  if (
    old &&
    old.every === data.recurrence.every &&
    old.unit === data.recurrence.unit &&
    dueDateOfCycle(old, cycleNo) === data.targetDate
  ) {
    return old;
  }
  return { ...data.recurrence, anchorDate: data.targetDate, anchorCycle: cycleNo };
}

export const createGoal = (ctx: Ctx, input: unknown) => saveGoal(ctx, null, input);
export const updateGoal = (ctx: Ctx, id: string, input: unknown) => saveGoal(ctx, id, input);

/**
 * Closes the open cycle of a repeating goal: records it in the history (with today's progress),
 * moves `targetDate` to the next due date and opens the next cycle. No money moves — paying the
 * bill from a linked account lowers its balance, so progress starts again by itself.
 */
async function closeCycle(
  ctx: Ctx,
  id: string,
  status: GoalCycle["status"],
): Promise<{ id: string; nextDueDate: string }> {
  await connectDb();
  const userId = uid(ctx);
  const goal = await GoalModel.findOne({ _id: toObjectId(id, "Goal"), userId }).lean<GoalDoc>();
  if (!goal) throw new AppError("NOT_FOUND", "Goal not found");
  if (goal.kind !== "recurring" || !goal.recurrence) {
    throw new AppError("CONFLICT", "Only repeating goals have cycles");
  }
  if (goal.status === "archived") throw new AppError("CONFLICT", "Restore the goal first");
  const ids = (kind: "account" | "holding") =>
    goal.links.filter((l) => l.kind === kind).map((l) => l.refId);
  const [accounts, holdings] = await Promise.all([
    AccountModel.find({
      userId,
      archivedAt: null,
      $or: [{ _id: { $in: ids("account") } }, { goalId: goal._id }],
    }).lean<AccountDoc[]>(),
    HoldingModel.find({ userId, status: "active", _id: { $in: ids("holding") } }).lean<
      HoldingDoc[]
    >(),
  ]);
  const current = toDTO(
    ctx,
    goal,
    await linkValues(ctx, accounts, holdings),
    accounts.filter((a) => a.goalId && a.goalId.equals(goal._id)),
  ).currentMinor;
  const cycleNo = goal.cycleNo ?? 0;
  const nextDueDate = dueDateOfCycle(goal.recurrence, cycleNo + 1);
  const entry: GoalCycle = {
    cycleNo,
    dueDate: goal.targetDate,
    targetMinor: goal.targetMinor,
    currentAtCloseMinor: current,
    status,
    closedOn: todayOf(ctx),
  };
  return withTransaction(async (session) => {
    // Guarded by the cycle number so a double click cannot close the same cycle twice.
    const res = await GoalModel.updateOne(
      { _id: goal._id, userId, cycleNo },
      { $push: { cycles: entry }, $set: { cycleNo: cycleNo + 1, targetDate: nextDueDate } },
      { session, runValidators: true },
    );
    if (!res.modifiedCount) throw new AppError("CONFLICT", "This cycle was already closed");
    return { id, nextDueDate };
  });
}

export const completeGoalCycle = (ctx: Ctx, id: string) => closeCycle(ctx, id, "completed");
export const skipGoalCycle = (ctx: Ctx, id: string) => closeCycle(ctx, id, "skipped");

/**
 * Goal savings accounts go back to normal money when their goal is archived or deleted (owner
 * decision). Same DB transaction; audited.
 */
async function releaseGoalAccounts(
  ctx: Ctx,
  goalId: Types.ObjectId,
  session: ClientSession,
): Promise<number> {
  const userId = uid(ctx);
  const accounts = await AccountModel.find({ userId, goalId })
    .session(session)
    .select({ _id: 1 })
    .lean<Pick<AccountDoc, "_id">[]>();
  if (!accounts.length) return 0;
  await AccountModel.updateMany({ userId, goalId }, { $set: { goalId: null } }, { session });
  await writeAudit(
    {
      userId: ctx.userId,
      action: "goal_accounts_released",
      entity: "goal",
      entityId: goalId,
      before: { accountIds: accounts.map((a) => a._id) },
    },
    session,
  );
  return accounts.length;
}

/** Archiving releases the goal's savings accounts; restoring does not take them back. */
export async function setGoalArchived(
  ctx: Ctx,
  id: string,
  archived: boolean,
): Promise<{ id: string; releasedAccounts: number }> {
  return withTransaction(async (session) => {
    const goalId = toObjectId(id, "Goal");
    const res = await GoalModel.updateOne(
      { _id: goalId, userId: uid(ctx) },
      { $set: { status: archived ? "archived" : "active" } },
      { session },
    );
    if (!res.matchedCount) throw new AppError("NOT_FOUND", "Goal not found");
    const releasedAccounts = archived ? await releaseGoalAccounts(ctx, goalId, session) : 0;
    return { id, releasedAccounts };
  });
}

/**
 * Goals are plans, not ledger records: deleting one removes the plan; its savings accounts go back
 * to normal money.
 */
export async function deleteGoal(ctx: Ctx, id: string): Promise<{ id: string }> {
  return withTransaction(async (session) => {
    const goalId = toObjectId(id, "Goal");
    const res = await GoalModel.deleteOne({ _id: goalId, userId: uid(ctx) }, { session });
    if (res.deletedCount) await releaseGoalAccounts(ctx, goalId, session);
    return { id };
  });
}

/** Active goals for pickers (account form: "Kept for goal"). */
export async function listGoalOptions(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  await connectDb();
  const goals = await GoalModel.find({ userId: uid(ctx), status: { $ne: "archived" } })
    .sort({ priority: 1, name: 1 })
    .select({ name: 1 })
    .lean<Pick<GoalDoc, "_id" | "name">[]>();
  return goals.map((g) => ({ id: String(g._id), name: g.name }));
}
