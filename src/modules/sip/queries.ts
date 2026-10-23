import "server-only";
import { Types } from "mongoose";
import { isSpendableCash } from "@/domain/earmarks";
import { utcToBusinessDate } from "@/domain/dates";
import { cashflowSplit } from "@/domain/rebalance";
import { xirrBp } from "@/domain/returns";
import {
  consistencyBp,
  estimatedShareMinor,
  graceEnd,
  periodsUntil,
  steppedAmount,
  versionFor,
} from "@/domain/sip";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { getTarget, getTreeOptions } from "@/modules/allocation/service";
import type { TargetDTO, TreeOptions } from "@/modules/allocation/schemas";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import {
  SipExecutionModel,
  SipPlanModel,
  SipPlanVersionModel,
  type SipExecutionDoc,
  type SipPlanDoc,
  type SipPlanVersionDoc,
} from "@/modules/sip/model";
import type { ExecutionDTO, HistoryFilters, PlanDTO } from "@/modules/sip/schemas";
import { generateDueExecutions, toExecutionDTO, toPlanDTO } from "@/modules/sip/service";
import { businessDateToUtc } from "@/domain/dates";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";

const keyOf = (ctx: Ctx, d: Date) => utcToBusinessDate(d, ctx.tz);
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);

/** Generation runs when SIP data is read until the daily cron exists (Phase 10). Idempotent. */
async function ensureGenerated(ctx: Ctx) {
  await generateDueExecutions(ctx);
}

export interface PlanCard {
  plan: PlanDTO;
  accountName: string;
  nextDue: { id: string; dueDate: string; plannedTotalMinor: number; status: string } | null;
  consistencyBp: number | null;
  investedMinor: number;
  /** Estimated share of holding values (docs/04 §7) — always labelled "estimated". */
  estimatedValueMinor: number;
  xirrBp: number | null;
}

interface Perf {
  investedMinor: number;
  estimatedValueMinor: number;
  xirrBp: number | null;
}

function planPerformance(
  ctx: Ctx,
  executions: readonly SipExecutionDoc[],
  holdings: ReadonlyMap<string, HoldingDoc>,
): Perf {
  const byHolding = new Map<string, number>();
  const flows: { date: string; amountMinor: number }[] = [];
  let invested = 0;
  for (const e of executions) {
    if (e.status !== "done" && e.status !== "partial") continue;
    for (const l of e.lines) {
      if (l.actualMinor <= 0 || !l.holdingId) continue;
      const key = String(l.holdingId);
      byHolding.set(key, (byHolding.get(key) ?? 0) + l.actualMinor + l.feeMinor);
      invested += l.actualMinor;
      flows.push({ date: keyOf(ctx, e.executedAt!), amountMinor: -(l.actualMinor + l.feeMinor) });
    }
  }
  let estimated = 0;
  for (const [id, planInvested] of byHolding) {
    const h = holdings.get(id);
    if (h) estimated += estimatedShareMinor(h.currentValueMinor, planInvested, h.investedMinor);
  }
  if (estimated > 0) flows.push({ date: todayOf(ctx), amountMinor: estimated });
  return { investedMinor: invested, estimatedValueMinor: estimated, xirrBp: xirrBp(flows) };
}

export async function getSipOverview(ctx: Ctx): Promise<PlanCard[]> {
  await ensureGenerated(ctx);
  const userId = toObjectId(ctx.userId, "User");
  const [plans, versions, executions, accounts, holdings] = await Promise.all([
    SipPlanModel.find({ userId }).sort({ status: 1, name: 1 }).lean<SipPlanDoc[]>(),
    SipPlanVersionModel.find({ userId }).lean<SipPlanVersionDoc[]>(),
    SipExecutionModel.find({ userId }).sort({ dueDate: 1 }).lean<SipExecutionDoc[]>(),
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
    HoldingModel.find({ userId }).lean<HoldingDoc[]>(),
  ]);
  const holdingMap = new Map(holdings.map((h) => [String(h._id), h]));
  const today = todayOf(ctx);
  return plans.map((p) => {
    const id = String(p._id);
    const mine = executions.filter((e) => String(e.planId) === id);
    const current =
      versions.find((v) => String(v.planId) === id && v.version === p.currentVersion) ?? null;
    const next = mine.find((e) => e.status === "due" || e.status === "missed");
    return {
      plan: toPlanDTO(ctx, p, current),
      accountName: accounts.find((a) => String(a._id) === String(p.sourceAccountId))?.name ?? "—",
      nextDue: next
        ? {
            id: String(next._id),
            dueDate: keyOf(ctx, next.dueDate),
            plannedTotalMinor: next.plannedTotalMinor,
            status: next.status,
          }
        : null,
      consistencyBp: consistencyBp(
        mine.map((e) => ({ status: e.status, dueDate: keyOf(ctx, e.dueDate), onTime: e.onTime })),
        today,
      ),
      ...planPerformance(ctx, mine, holdingMap),
    };
  });
}

export interface ExecutionRow extends ExecutionDTO {
  planName: string;
  currency: string;
  overdue: boolean;
}

function row(
  ctx: Ctx,
  e: SipExecutionDoc,
  plan: SipPlanDoc | undefined,
  today: string,
): ExecutionRow {
  const dto = toExecutionDTO(ctx, e);
  return {
    ...dto,
    planName: plan?.name ?? "Plan",
    currency: plan?.currency ?? ctx.baseCurrency,
    overdue: dto.status === "missed" || (dto.status === "due" && dto.dueDate < today),
  };
}

/** Due and overdue (missed) executions, oldest first. */
export async function listUpcomingExecutions(ctx: Ctx): Promise<ExecutionRow[]> {
  await ensureGenerated(ctx);
  const userId = toObjectId(ctx.userId, "User");
  const [executions, plans] = await Promise.all([
    SipExecutionModel.find({ userId, status: { $in: ["due", "missed"] } })
      .sort({ dueDate: 1 })
      .lean<SipExecutionDoc[]>(),
    SipPlanModel.find({ userId }).lean<SipPlanDoc[]>(),
  ]);
  const byId = new Map(plans.map((p) => [String(p._id), p]));
  const today = todayOf(ctx);
  return executions.map((e) => row(ctx, e, byId.get(String(e.planId)), today));
}

/** History timeline (newest first) with filters. */
export async function listHistory(ctx: Ctx, filters: HistoryFilters): Promise<ExecutionRow[]> {
  await ensureGenerated(ctx);
  const userId = toObjectId(ctx.userId, "User");
  const today = todayOf(ctx);
  const date: Record<string, Date> = { $lte: businessDateToUtc(filters.to ?? today, ctx.tz) };
  if (filters.from) date.$gte = businessDateToUtc(filters.from, ctx.tz);
  const [executions, plans] = await Promise.all([
    SipExecutionModel.find({
      userId,
      dueDate: date,
      ...(filters.plan ? { planId: new Types.ObjectId(filters.plan) } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    })
      .sort({ dueDate: -1 })
      .limit(500)
      .lean<SipExecutionDoc[]>(),
    SipPlanModel.find({ userId }).lean<SipPlanDoc[]>(),
  ]);
  const byId = new Map(plans.map((p) => [String(p._id), p]));
  return executions.map((e) => row(ctx, e, byId.get(String(e.planId)), today));
}

export interface PlanCharts {
  planId: string;
  currency: string;
  /** Cumulative invested after each execution (date of execution). */
  cumulative: { date: string; investedMinor: number }[];
  estimatedValueMinor: number;
  investedMinor: number;
  /** Planned vs actual per period (oldest first). */
  periods: { periodKey: string; plannedMinor: number; actualMinor: number; status: string }[];
}

export async function getPlanCharts(ctx: Ctx, planId: string): Promise<PlanCharts> {
  const userId = toObjectId(ctx.userId, "User");
  const plan = await SipPlanModel.findOne({
    _id: toObjectId(planId, "Plan"),
    userId,
  }).lean<SipPlanDoc>();
  if (!plan) throw new AppError("NOT_FOUND", "SIP plan not found");
  const [executions, holdings] = await Promise.all([
    SipExecutionModel.find({ userId, planId: plan._id })
      .sort({ dueDate: 1 })
      .lean<SipExecutionDoc[]>(),
    HoldingModel.find({ userId }).lean<HoldingDoc[]>(),
  ]);
  const today = todayOf(ctx);
  const executed = executions
    .filter((e) => (e.status === "done" || e.status === "partial") && e.executedAt)
    .sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime());
  let running = 0;
  const cumulative = executed.map((e) => {
    running += e.actualTotalMinor;
    return { date: keyOf(ctx, e.executedAt!), investedMinor: running };
  });
  const perf = planPerformance(ctx, executions, new Map(holdings.map((h) => [String(h._id), h])));
  return {
    planId,
    currency: plan.currency,
    cumulative,
    estimatedValueMinor: perf.estimatedValueMinor,
    investedMinor: perf.investedMinor,
    periods: executions
      .filter((e) => keyOf(ctx, e.dueDate) <= today)
      .map((e) => ({
        periodKey: e.periodKey,
        plannedMinor: e.plannedTotalMinor,
        actualMinor: e.actualTotalMinor,
        status: e.status,
      })),
  };
}

export interface ExecuteView {
  execution: ExecutionRow;
  plan: PlanDTO;
  account: { id: string; name: string; currency: string; balanceMinor: number };
  graceEnd: string;
  classes: { id: string; name: string; color: string }[];
  /** Active holdings in the plan currency, per class (for lines without a holding, or to switch). */
  holdingsByClass: Record<string, { id: string; name: string }[]>;
  /** Drift-tilted planned amounts aligned to execution lines (docs/04 §8 cashflow split). */
  tiltedPlanned: number[] | null;
}

export async function getExecuteView(ctx: Ctx, executionId: string): Promise<ExecuteView> {
  const userId = toObjectId(ctx.userId, "User");
  const e = await SipExecutionModel.findOne({
    _id: toObjectId(executionId, "Execution"),
    userId,
  }).lean<SipExecutionDoc>();
  if (!e) throw new AppError("NOT_FOUND", "SIP execution not found");
  const [plan, version, classes, holdings] = await Promise.all([
    SipPlanModel.findOne({ _id: e.planId, userId }).lean<SipPlanDoc>(),
    SipPlanVersionModel.findOne({
      userId,
      planId: e.planId,
      version: e.planVersion,
    }).lean<SipPlanVersionDoc>(),
    AssetClassModel.find({ userId }).sort({ sortOrder: 1, name: 1 }).lean<AssetClassDoc[]>(),
    HoldingModel.find({ userId, status: "active" }).sort({ name: 1 }).lean<HoldingDoc[]>(),
  ]);
  if (!plan) throw new AppError("NOT_FOUND", "SIP plan not found");
  const account = await AccountModel.findOne({
    _id: plan.sourceAccountId,
    userId,
  }).lean<AccountDoc>();
  const inCurrency = holdings.filter((h) => h.currency === plan.currency);
  const holdingsByClass: ExecuteView["holdingsByClass"] = {};
  for (const h of inCurrency) {
    (holdingsByClass[String(h.assetClassId)] ??= []).push({ id: String(h._id), name: h.name });
  }
  // Drift tilt: split the planned total by deficits against current class values (plan currency).
  const dto = toExecutionDTO(ctx, e);
  let tiltedPlanned: number[] | null = null;
  if (dto.allocationUsed.length && dto.plannedTotalMinor > 0) {
    const classValues: Record<string, number> = {};
    for (const h of inCurrency) {
      const k = String(h.assetClassId);
      classValues[k] = (classValues[k] ?? 0) + h.currentValueMinor;
    }
    const split = cashflowSplit(dto.plannedTotalMinor, dto.allocationUsed, classValues);
    tiltedPlanned = dto.lines.map(
      (l) =>
        split.find((s) => s.assetClassId === l.assetClassId && s.holdingId === l.holdingId)
          ?.amountMinor ?? 0,
    );
  }
  return {
    execution: row(ctx, e, plan, todayOf(ctx)),
    plan: toPlanDTO(ctx, plan, version),
    account: {
      id: String(plan.sourceAccountId),
      name: account?.name ?? "Account",
      currency: account?.currency ?? plan.currency,
      balanceMinor: account?.balanceMinor ?? 0,
    },
    graceEnd: graceEnd(dto.dueDate, plan.graceDays),
    classes: classes.map((c) => ({ id: String(c._id), name: c.name, color: c.color })),
    holdingsByClass,
    tiltedPlanned,
  };
}

export interface PlanEditorData {
  plan: PlanDTO | null;
  accounts: { id: string; name: string; currency: string }[];
  treeOptions: TreeOptions;
  target: TargetDTO;
  /** Where a new version would start (next unexecuted due date) — for "creates version N". */
  nextDueDate: string | null;
}

export async function getPlanEditor(ctx: Ctx, planId?: string): Promise<PlanEditorData> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const [accounts, treeOptions, target] = await Promise.all([
    AccountModel.find({
      userId,
      archivedAt: null,
      type: { $in: ["bank", "cash", "wallet", "broker_cash", "opportunity_fund"] },
    })
      .sort({ name: 1 })
      .lean<AccountDoc[]>(),
    getTreeOptions(ctx),
    getTarget(ctx),
  ]);
  let plan: PlanDTO | null = null;
  let nextDueDate: string | null = null;
  if (planId) {
    const p = await SipPlanModel.findOne({
      _id: toObjectId(planId, "Plan"),
      userId,
    }).lean<SipPlanDoc>();
    if (!p) throw new AppError("NOT_FOUND", "SIP plan not found");
    const v = await SipPlanVersionModel.findOne({
      userId,
      planId: p._id,
      version: p.currentVersion,
    }).lean<SipPlanVersionDoc>();
    plan = toPlanDTO(ctx, p, v);
    const next = await SipExecutionModel.findOne({ userId, planId: p._id, status: "due" })
      .sort({ dueDate: 1 })
      .lean<SipExecutionDoc>();
    nextDueDate = next ? keyOf(ctx, next.dueDate) : null;
  }
  return {
    plan,
    accounts: accounts.map((a) => ({ id: String(a._id), name: a.name, currency: a.currency })),
    treeOptions,
    target,
    nextDueDate,
  };
}

/**
 * SIP items for the dashboard's Upcoming / safe to spend (docs/04 §21): generated due/missed
 * executions up to `until`, plus projected periods not generated yet. `outflowMinor` only when the
 * source account is earmarkable (that money comes out of free cash).
 */
export async function sipUpcoming(
  ctx: Ctx,
  until: string,
): Promise<
  {
    id: string;
    title: string;
    dueDate: string;
    amountMinor: number;
    currency: string;
    outflowMinor: number | null;
    accountId: string;
    href: string;
  }[]
> {
  await ensureGenerated(ctx);
  const userId = toObjectId(ctx.userId, "User");
  const [plans, versions, executions, accounts] = await Promise.all([
    SipPlanModel.find({ userId, status: "active" }).lean<SipPlanDoc[]>(),
    SipPlanVersionModel.find({ userId }).lean<SipPlanVersionDoc[]>(),
    SipExecutionModel.find({ userId }).lean<SipExecutionDoc[]>(),
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
  ]);
  const out = [];
  for (const p of plans) {
    const account = accounts.find((a) => String(a._id) === String(p.sourceAccountId));
    const earmarkable = account ? isSpendableCash(account) : false;
    const mine = executions.filter((e) => String(e.planId) === String(p._id));
    const known = new Set(mine.map((e) => e.periodKey));
    for (const e of mine) {
      if (e.status !== "due" && e.status !== "missed") continue;
      const due = keyOf(ctx, e.dueDate);
      if (due > until) continue;
      out.push({
        id: `sip-${String(e._id)}`,
        title: `${p.name} SIP`,
        dueDate: due,
        amountMinor: e.plannedTotalMinor,
        currency: p.currency,
        outflowMinor: earmarkable ? e.plannedTotalMinor : null,
        accountId: String(p.sourceAccountId),
        href: `/sip/execute/${String(e._id)}`,
      });
    }
    // Projected beyond what generation has created (no carry-in; the amount of the version in force).
    const planVersions = versions
      .filter((v) => String(v.planId) === String(p._id))
      .map((v) => ({ ...v, effectiveFrom: keyOf(ctx, v.effectiveFrom) }));
    for (const period of periodsUntil(
      {
        frequency: p.frequency,
        dayOfMonth: p.dayOfMonth,
        weekday: p.weekday,
        startDate: keyOf(ctx, p.resumedAt && p.resumedAt > p.startDate ? p.resumedAt : p.startDate),
        endDate: p.endDate ? keyOf(ctx, p.endDate) : null,
      },
      until,
    )) {
      if (known.has(period.periodKey) || period.dueDate < todayOf(ctx)) continue;
      const v = versionFor(planVersions, period.dueDate);
      if (!v) continue;
      const amount = steppedAmount(
        v.amountMinor,
        p.currency,
        p.stepUp,
        keyOf(ctx, p.startDate),
        period.dueDate,
      );
      out.push({
        id: `sip-${String(p._id)}-${period.periodKey}`,
        title: `${p.name} SIP`,
        dueDate: period.dueDate,
        amountMinor: amount,
        currency: p.currency,
        outflowMinor: earmarkable ? amount : null,
        accountId: String(p.sourceAccountId),
        href: "/sip?tab=upcoming",
      });
    }
  }
  return out;
}
