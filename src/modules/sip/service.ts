import "server-only";
import { Types, type ClientSession } from "mongoose";
import { splitByTree, type AllocationTree } from "@/domain/allocation";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import {
  carryIn,
  executionStatus,
  isMissed,
  isOnTime,
  periodsUntil,
  steppedAmount,
  versionFor,
  type ExecutionStatus,
} from "@/domain/sip";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { assertValidTree, getTarget, treeFromDoc, treeToDoc } from "@/modules/allocation/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import {
  SipExecutionModel,
  SipPlanModel,
  SipPlanVersionModel,
  type ExecutionLineDoc,
  type SipExecutionDoc,
  type SipPlanDoc,
  type SipPlanVersionDoc,
} from "@/modules/sip/model";
import {
  executeInputSchema,
  planInputSchema,
  skipInputSchema,
  type ExecutionDTO,
  type PlanData,
  type PlanDTO,
} from "@/modules/sip/schemas";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { guardGroupOutflow, postTransaction } from "@/server/ledger/post";
import { voidTransaction } from "@/server/ledger/void";

// docs/04 §7 — SIP engine. Executions are generated idempotently (unique {planId, periodKey});
// not-yet-executed `due` executions are re-planned whenever their inputs change.

const GENERATE_AHEAD_DAYS = 7;

const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);
const keyOf = (ctx: Ctx, d: Date) => utcToBusinessDate(d, ctx.tz);
const addDaysKey = (key: string, days: number) =>
  utcToBusinessDate(new Date(businessDateToUtc(key, "UTC").getTime() + days * 86_400_000), "UTC");

export function toPlanDTO(ctx: Ctx, p: SipPlanDoc, current: SipPlanVersionDoc | null): PlanDTO {
  return {
    id: String(p._id),
    name: p.name,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    frequency: p.frequency,
    dayOfMonth: p.dayOfMonth ?? null,
    weekday: p.weekday ?? null,
    sourceAccountId: String(p.sourceAccountId),
    startDate: keyOf(ctx, p.startDate),
    endDate: p.endDate ? keyOf(ctx, p.endDate) : null,
    stepUp: p.stepUp ? { percentBp: p.stepUp.percentBp, everyMonths: p.stepUp.everyMonths } : null,
    missedPolicy: p.missedPolicy,
    graceDays: p.graceDays,
    useDriftTilt: p.useDriftTilt,
    currentVersion: p.currentVersion,
    notes: p.notes ?? null,
    allocationSource: current?.allocationSource ?? "target",
    allocation: current?.allocationSource === "custom" ? treeFromDoc(current.allocation) : [],
  };
}

export function toExecutionDTO(ctx: Ctx, e: SipExecutionDoc): ExecutionDTO {
  return {
    id: String(e._id),
    planId: String(e.planId),
    planVersion: e.planVersion,
    periodKey: e.periodKey,
    dueDate: keyOf(ctx, e.dueDate),
    status: e.status,
    plannedTotalMinor: e.plannedTotalMinor,
    carryInMinor: e.carryInMinor,
    actualTotalMinor: e.actualTotalMinor,
    executedOn: e.executedAt ? keyOf(ctx, e.executedAt) : null,
    skipReason: e.skipReason ?? null,
    onTime: e.onTime ?? null,
    lines: e.lines.map((l) => ({
      assetClassId: String(l.assetClassId),
      holdingId: l.holdingId ? String(l.holdingId) : null,
      plannedMinor: l.plannedMinor,
      actualMinor: l.actualMinor,
      feeMinor: l.feeMinor,
      units: l.units ?? null,
      priceMinorE4: l.priceMinorE4 ?? null,
      transactionId: l.transactionId ? String(l.transactionId) : null,
    })),
    allocationUsed: treeFromDoc(e.allocationUsed),
  };
}

async function loadPlan(ctx: Ctx, id: string, session?: ClientSession): Promise<SipPlanDoc> {
  const q = SipPlanModel.findOne({
    _id: toObjectId(id, "Plan"),
    userId: toObjectId(ctx.userId, "User"),
  });
  if (session) q.session(session);
  const plan = await q.lean<SipPlanDoc>();
  if (!plan) throw new AppError("NOT_FOUND", "SIP plan not found");
  return plan;
}

async function loadVersions(ctx: Ctx, planId: Types.ObjectId, session?: ClientSession) {
  const q = SipPlanVersionModel.find({ userId: toObjectId(ctx.userId, "User"), planId }).sort({
    version: 1,
  });
  if (session) q.session(session);
  return q.lean<SipPlanVersionDoc[]>();
}

async function assertSourceAccount(
  ctx: Ctx,
  id: string,
  session: ClientSession,
): Promise<AccountDoc> {
  const account = await AccountModel.findOne({
    _id: toObjectId(id, "Account"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<AccountDoc>();
  if (!account)
    throw new AppError("VALIDATION", "Account not found", {
      sourceAccountId: ["Account not found"],
    });
  if (account.archivedAt) {
    throw new AppError("VALIDATION", "That account is archived", {
      sourceAccountId: ["Archived account"],
    });
  }
  return account;
}

async function validateAllocation(
  ctx: Ctx,
  data: PlanData,
  currency: string,
  session: ClientSession,
) {
  if (data.allocationSource !== "custom") return [];
  const tree = data.allocation ?? [];
  const warnings = await assertValidTree(ctx, tree, { requireAssets: true, session });
  // Invest postings need the holding in the plan's (source account's) currency.
  const ids = tree.flatMap((c) => c.assets.map((a) => new Types.ObjectId(a.holdingId)));
  const other = await HoldingModel.findOne({
    userId: toObjectId(ctx.userId, "User"),
    _id: { $in: ids },
    currency: { $ne: currency },
  })
    .session(session)
    .lean<HoldingDoc>();
  if (other) {
    throw new AppError(
      "VALIDATION",
      `"${other.name}" is in ${other.currency}; the plan invests ${currency}`,
      {
        allocation: [`"${other.name}" is in another currency`],
      },
    );
  }
  return warnings;
}

/** The tree a version invests with: its own (custom) or the live target. */
function treeOf(
  version: Pick<SipPlanVersionDoc, "allocationSource" | "allocation">,
  target: AllocationTree,
): AllocationTree {
  return version.allocationSource === "custom" ? treeFromDoc(version.allocation) : target;
}

function planLines(total: number, tree: AllocationTree): ExecutionLineDoc[] {
  if (tree.length === 0 || total <= 0) return [];
  return splitByTree(total, tree).map((l) => ({
    assetClassId: new Types.ObjectId(l.assetClassId),
    holdingId: l.holdingId ? new Types.ObjectId(l.holdingId) : null,
    plannedMinor: l.amountMinor,
    actualMinor: 0,
    feeMinor: 0,
    units: null,
    priceMinorE4: null,
    transactionId: null,
  }));
}

/**
 * Re-plans every not-yet-executed `due` execution of a plan (version, step-up, carry-in from the
 * previous period, tree) and marks overdue ones missed. Executed/skipped/missed rows keep what
 * they had — past executions keep the tree they used.
 */
async function refreshPending(
  ctx: Ctx,
  plan: SipPlanDoc,
  session: ClientSession,
  target?: AllocationTree,
) {
  const userId = toObjectId(ctx.userId, "User");
  const today = todayOf(ctx);
  const versions = await loadVersions(ctx, plan._id, session);
  const live = target ?? (await getTarget(ctx, session)).allocation;
  const executions = await SipExecutionModel.find({ userId, planId: plan._id })
    .sort({ dueDate: 1 })
    .session(session)
    .lean<SipExecutionDoc[]>();
  const startKey = keyOf(ctx, plan.startDate);
  let prev: SipExecutionDoc | null = null;
  for (const e of executions) {
    let current = e;
    const due = keyOf(ctx, e.dueDate);
    if (e.status === "due") {
      const version = versionFor(
        versions.map((v) => ({ ...v, effectiveFrom: keyOf(ctx, v.effectiveFrom) })),
        due,
      );
      if (version) {
        const stepped = steppedAmount(
          version.amountMinor,
          plan.currency,
          plan.stepUp,
          startKey,
          due,
        );
        const carry = carryIn(plan.missedPolicy, prev);
        const tree = treeOf(version, live);
        const status: ExecutionStatus = isMissed("due", due, plan.graceDays, today)
          ? "missed"
          : "due";
        const $set = {
          planVersion: version.version,
          carryInMinor: carry,
          plannedTotalMinor: stepped + carry,
          lines: planLines(stepped + carry, tree),
          allocationUsed: treeToDoc(tree),
          status,
        };
        await SipExecutionModel.updateOne(
          { _id: e._id, userId, status: "due" },
          { $set },
          { session },
        );
        current = { ...e, ...$set };
      }
    }
    prev = current;
  }
}

/**
 * Job function (docs/04 §7; cron in Phase 10, and run when SIP pages load until then): creates
 * missing executions from start (or resume) to today + 7 days, then re-plans pending ones and
 * marks overdue ones missed. Idempotent.
 */
export async function generateDueExecutions(ctx: Ctx, todayKey?: string): Promise<number> {
  await connectDb();
  const today = todayKey ?? todayOf(ctx);
  const userId = toObjectId(ctx.userId, "User");
  const plans = await SipPlanModel.find({ userId, status: { $in: ["active", "paused"] } }).lean<
    SipPlanDoc[]
  >();
  let created = 0;
  for (const plan of plans) {
    if (plan.status === "active") {
      const from =
        plan.resumedAt && plan.resumedAt > plan.startDate ? plan.resumedAt : plan.startDate;
      const periods = periodsUntil(
        {
          frequency: plan.frequency,
          dayOfMonth: plan.dayOfMonth,
          weekday: plan.weekday,
          startDate: keyOf(ctx, from),
          endDate: plan.endDate ? keyOf(ctx, plan.endDate) : null,
        },
        addDaysKey(today, GENERATE_AHEAD_DAYS),
      );
      const existing = new Set(
        (
          await SipExecutionModel.find({ userId, planId: plan._id })
            .select({ periodKey: 1 })
            .lean<{ periodKey: string }[]>()
        ).map((e) => e.periodKey),
      );
      const missing = periods.filter((p) => !existing.has(p.periodKey));
      if (missing.length) {
        try {
          const res = await SipExecutionModel.insertMany(
            missing.map((p) => ({
              userId,
              planId: plan._id,
              planVersion: plan.currentVersion,
              periodKey: p.periodKey,
              dueDate: businessDateToUtc(p.dueDate, ctx.tz),
              status: "due",
              plannedTotalMinor: 0,
            })),
            { ordered: false },
          );
          created += res.length;
        } catch (err) {
          // A concurrent run inserted some periods first: the unique index keeps one of each.
          if ((err as { code?: number }).code !== 11000) throw err;
        }
      }
    }
    await withTransaction((session) => refreshPending(ctx, plan, session));
  }
  return created;
}

/** Re-plans pending executions of every plan (target saved, etc.). */
export async function refreshTargetFollowers(ctx: Ctx, session: ClientSession): Promise<void> {
  const userId = toObjectId(ctx.userId, "User");
  const plans = await SipPlanModel.find({ userId, status: { $ne: "ended" } })
    .session(session)
    .lean<SipPlanDoc[]>();
  const target = (await getTarget(ctx, session)).allocation;
  for (const plan of plans) await refreshPending(ctx, plan, session, target);
}

export async function createPlan(
  ctx: Ctx,
  input: unknown,
): Promise<{ plan: PlanDTO; warnings: string[] }> {
  const data = parseInput(planInputSchema, input);
  const result = await withTransaction(async (session) => {
    const account = await assertSourceAccount(ctx, data.sourceAccountId, session);
    const warnings = await validateAllocation(ctx, data, account.currency, session);
    const userId = toObjectId(ctx.userId, "User");
    const [plan] = await SipPlanModel.create(
      [
        {
          userId,
          name: data.name,
          amountMinor: data.amountMinor,
          currency: account.currency,
          frequency: data.frequency,
          dayOfMonth: data.frequency === "monthly" ? data.dayOfMonth : null,
          weekday: data.frequency === "weekly" ? data.weekday : null,
          sourceAccountId: account._id,
          startDate: businessDateToUtc(data.startDate, ctx.tz),
          endDate: data.endDate ? businessDateToUtc(data.endDate, ctx.tz) : null,
          stepUp: data.stepUp ?? null,
          missedPolicy: data.missedPolicy,
          graceDays: data.graceDays,
          useDriftTilt: data.useDriftTilt,
          notes: data.notes ?? null,
          currentVersion: 1,
        },
      ],
      { session },
    );
    const [version] = await SipPlanVersionModel.create(
      [
        {
          userId,
          planId: plan!._id,
          version: 1,
          effectiveFrom: businessDateToUtc(data.startDate, ctx.tz),
          amountMinor: data.amountMinor,
          allocationSource: data.allocationSource,
          allocation: data.allocationSource === "custom" ? treeToDoc(data.allocation ?? []) : [],
        },
      ],
      { session },
    );
    await writeAudit(
      { userId: ctx.userId, action: "create", entity: "sipPlan", entityId: plan!._id, after: data },
      session,
    );
    return {
      plan: toPlanDTO(
        ctx,
        plan!.toObject() as SipPlanDoc,
        version!.toObject() as SipPlanVersionDoc,
      ),
      warnings,
    };
  });
  await generateDueExecutions(ctx);
  return result;
}

/**
 * Edits a plan. Amount or allocation changes create version N+1, effective from the next
 * not-yet-executed due date; schedule changes drop pending (unexecuted) executions and regenerate.
 */
export async function updatePlan(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{
  plan: PlanDTO;
  newVersion: number | null;
  effectiveFrom: string | null;
  warnings: string[];
}> {
  const data = parseInput(planInputSchema, input);
  const result = await withTransaction(async (session) => {
    const plan = await loadPlan(ctx, id, session);
    if (plan.status === "ended") throw new AppError("CONFLICT", "This plan has ended");
    const account = await assertSourceAccount(ctx, data.sourceAccountId, session);
    if (account.currency !== plan.currency) {
      throw new AppError("VALIDATION", `Use a ${plan.currency} account for this plan`, {
        sourceAccountId: [`Must be a ${plan.currency} account`],
      });
    }
    const warnings = await validateAllocation(ctx, data, plan.currency, session);
    const userId = toObjectId(ctx.userId, "User");
    const versions = await loadVersions(ctx, plan._id, session);
    const current = versions.find((v) => v.version === plan.currentVersion) ?? versions.at(-1)!;
    const sameTree =
      JSON.stringify(
        current.allocationSource === "custom" ? treeFromDoc(current.allocation) : [],
      ) === JSON.stringify(data.allocationSource === "custom" ? (data.allocation ?? []) : []);
    const versionChanged =
      current.amountMinor !== data.amountMinor ||
      current.allocationSource !== data.allocationSource ||
      !sameTree;
    const scheduleChanged =
      plan.frequency !== data.frequency ||
      (plan.dayOfMonth ?? null) !==
        (data.frequency === "monthly" ? (data.dayOfMonth ?? null) : null) ||
      (plan.weekday ?? null) !== (data.frequency === "weekly" ? (data.weekday ?? null) : null) ||
      keyOf(ctx, plan.startDate) !== data.startDate;

    let newVersion: number | null = null;
    let effectiveFrom: string | null = null;
    if (versionChanged) {
      const nextDue = await SipExecutionModel.findOne({ userId, planId: plan._id, status: "due" })
        .sort({ dueDate: 1 })
        .session(session)
        .lean<SipExecutionDoc>();
      effectiveFrom = nextDue ? keyOf(ctx, nextDue.dueDate) : todayOf(ctx);
      newVersion = plan.currentVersion + 1;
      await SipPlanVersionModel.create(
        [
          {
            userId,
            planId: plan._id,
            version: newVersion,
            effectiveFrom: businessDateToUtc(effectiveFrom, ctx.tz),
            amountMinor: data.amountMinor,
            allocationSource: data.allocationSource,
            allocation: data.allocationSource === "custom" ? treeToDoc(data.allocation ?? []) : [],
          },
        ],
        { session },
      );
    }
    if (scheduleChanged) {
      await SipExecutionModel.deleteMany(
        { userId, planId: plan._id, status: { $in: ["due", "missed"] } },
        { session },
      );
    }
    await SipPlanModel.updateOne(
      { _id: plan._id, userId },
      {
        $set: {
          name: data.name,
          amountMinor: data.amountMinor,
          frequency: data.frequency,
          dayOfMonth: data.frequency === "monthly" ? data.dayOfMonth : null,
          weekday: data.frequency === "weekly" ? data.weekday : null,
          sourceAccountId: account._id,
          startDate: businessDateToUtc(data.startDate, ctx.tz),
          endDate: data.endDate ? businessDateToUtc(data.endDate, ctx.tz) : null,
          stepUp: data.stepUp ?? null,
          missedPolicy: data.missedPolicy,
          graceDays: data.graceDays,
          useDriftTilt: data.useDriftTilt,
          notes: data.notes ?? null,
          ...(newVersion ? { currentVersion: newVersion } : {}),
        },
      },
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "update",
        entity: "sipPlan",
        entityId: plan._id,
        after: { ...data, newVersion },
      },
      session,
    );
    const updated = await loadPlan(ctx, id, session);
    await refreshPending(ctx, updated, session);
    const latest = (await loadVersions(ctx, plan._id, session)).at(-1)!;
    return { plan: toPlanDTO(ctx, updated, latest), newVersion, effectiveFrom, warnings };
  });
  await generateDueExecutions(ctx);
  return result;
}

export async function setPlanStatus(
  ctx: Ctx,
  id: string,
  status: "active" | "paused" | "ended",
): Promise<PlanDTO> {
  const today = todayOf(ctx);
  const dto = await withTransaction(async (session) => {
    const plan = await loadPlan(ctx, id, session);
    const userId = toObjectId(ctx.userId, "User");
    if (plan.status === "ended") throw new AppError("CONFLICT", "This plan has ended");
    const $set: Record<string, unknown> = { status };
    if (status === "active" && plan.status === "paused") {
      // Resuming does not back-fill the paused periods (docs/04 §7).
      $set.resumedAt = businessDateToUtc(today, ctx.tz);
      await SipExecutionModel.deleteMany(
        {
          userId,
          planId: plan._id,
          status: "due",
          dueDate: { $lt: businessDateToUtc(today, ctx.tz) },
        },
        { session },
      );
    }
    if (status === "ended") {
      $set.endDate = businessDateToUtc(today, ctx.tz);
      await SipExecutionModel.deleteMany(
        {
          userId,
          planId: plan._id,
          status: "due",
          dueDate: { $gt: businessDateToUtc(today, ctx.tz) },
        },
        { session },
      );
    }
    await SipPlanModel.updateOne({ _id: plan._id, userId }, { $set }, { session });
    await writeAudit(
      { userId: ctx.userId, action: status, entity: "sipPlan", entityId: plan._id },
      session,
    );
    const updated = await loadPlan(ctx, id, session);
    return toPlanDTO(ctx, updated, (await loadVersions(ctx, plan._id, session)).at(-1) ?? null);
  });
  await generateDueExecutions(ctx);
  return dto;
}

async function loadExecution(
  ctx: Ctx,
  id: string,
  session: ClientSession,
): Promise<SipExecutionDoc> {
  const e = await SipExecutionModel.findOne({
    _id: toObjectId(id, "Execution"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<SipExecutionDoc>();
  if (!e) throw new AppError("NOT_FOUND", "SIP execution not found");
  return e;
}

/**
 * Execute (one DB transaction, docs/04 §7): validates lines, runs the dip guard once on the
 * total, posts one `invest` per line with actual > 0 (source sip_execution, shared groupId),
 * then sets status done/partial and onTime. Over-investing is allowed. Returns a warning when the
 * source account ends below zero (never blocks).
 */
export async function executeSip(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ execution: ExecutionDTO; warnings: string[] }> {
  const data = parseInput(executeInputSchema, input);
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const e = await loadExecution(ctx, id, session);
    if (e.status !== "due" && e.status !== "missed") {
      throw new AppError("CONFLICT", "This period was already executed or skipped");
    }
    const plan = await loadPlan(ctx, String(e.planId), session);
    if (e.lines.length === 0) {
      throw new AppError(
        "VALIDATION",
        "This period has no allocation: set the target allocation or a custom tree first",
      );
    }
    if (data.lines.length !== e.lines.length) {
      throw new AppError("VALIDATION", "The lines do not match this period; reload and try again");
    }
    const holdingIds = data.lines
      .map((l, i) => l.holdingId ?? (e.lines[i]!.holdingId ? String(e.lines[i]!.holdingId) : null))
      .filter((v): v is string => Boolean(v));
    const holdings = new Map(
      (
        await HoldingModel.find({
          userId,
          _id: { $in: holdingIds.map((h) => new Types.ObjectId(h)) },
        })
          .session(session)
          .lean<HoldingDoc[]>()
      ).map((h) => [String(h._id), h]),
    );
    const lines: ExecutionLineDoc[] = e.lines.map((planned, i) => {
      const input = data.lines[i]!;
      const holdingId = input.holdingId ?? (planned.holdingId ? String(planned.holdingId) : null);
      if (input.actualMinor > 0) {
        const h = holdingId ? holdings.get(holdingId) : undefined;
        const field = `lines.${i}.holdingId`;
        if (!h)
          throw new AppError("VALIDATION", "Choose a holding for every line you invest in", {
            [field]: ["Choose a holding"],
          });
        if (h.status !== "active")
          throw new AppError("VALIDATION", `"${h.name}" is closed`, {
            [field]: ["Closed holding"],
          });
        if (String(h.assetClassId) !== String(planned.assetClassId)) {
          throw new AppError("VALIDATION", `"${h.name}" is in another asset class`, {
            [field]: ["Wrong class"],
          });
        }
      }
      return {
        ...planned,
        holdingId: holdingId ? new Types.ObjectId(holdingId) : null,
        actualMinor: input.actualMinor,
        feeMinor: input.actualMinor > 0 ? input.feeMinor : 0,
        units: input.actualMinor > 0 ? (input.units ?? null) : null,
        priceMinorE4: input.actualMinor > 0 ? (input.priceMinorE4 ?? null) : null,
        transactionId: null,
      };
    });
    const actualTotal = lines.reduce((s, l) => s + l.actualMinor, 0);
    let status: "done" | "partial";
    try {
      status = executionStatus(e.plannedTotalMinor, actualTotal);
    } catch (err) {
      throw new AppError("VALIDATION", (err as Error).message);
    }
    const outflow = lines.reduce((s, l) => s + l.actualMinor + l.feeMinor, 0);
    await guardGroupOutflow(
      ctx,
      String(plan.sourceAccountId),
      outflow,
      {
        source: "sip_execution",
        confirmOpportunity: data.confirmOpportunity,
        confirmEmergency: data.confirmEmergency,
      },
      session,
    );
    const groupId = new Types.ObjectId();
    const date = businessDateToUtc(data.executedOn, ctx.tz);
    for (const line of lines) {
      if (line.actualMinor <= 0) continue;
      const txn = await postTransaction(
        ctx,
        {
          type: "invest",
          date,
          amountMinor: line.actualMinor,
          feeMinor: line.feeMinor,
          fromAccountId: String(plan.sourceAccountId),
          holdingId: String(line.holdingId),
          units: line.units,
          priceMinorE4: line.priceMinorE4,
          description: `${plan.name} · ${e.periodKey}`,
          source: { kind: "sip_execution", refId: e._id },
          groupId,
          dipGuardDone: true,
        },
        session,
      );
      line.transactionId = txn._id;
    }
    const $set = {
      lines,
      actualTotalMinor: actualTotal,
      status,
      executedAt: date,
      onTime: isOnTime(data.executedOn, keyOf(ctx, e.dueDate), plan.graceDays),
      groupId,
    };
    await SipExecutionModel.updateOne({ _id: e._id, userId }, { $set }, { session });
    await writeAudit(
      {
        userId: ctx.userId,
        action: "execute",
        entity: "sipExecution",
        entityId: e._id,
        after: { status, actualTotal },
      },
      session,
    );
    await refreshPending(ctx, plan, session);
    const account = await AccountModel.findOne({ _id: plan.sourceAccountId, userId })
      .session(session)
      .lean<AccountDoc>();
    const warnings =
      account && account.balanceMinor < 0 ? [`"${account.name}" is now below zero`] : [];
    return { execution: toExecutionDTO(ctx, { ...e, ...$set }), warnings };
  });
}

/** Skip: status skipped with a reason; no transactions (docs/04 §7). */
export async function skipSip(ctx: Ctx, id: string, input: unknown): Promise<ExecutionDTO> {
  const { reason } = parseInput(skipInputSchema, input);
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const e = await loadExecution(ctx, id, session);
    if (e.status !== "due" && e.status !== "missed") {
      throw new AppError("CONFLICT", "Only a due or missed period can be skipped");
    }
    await SipExecutionModel.updateOne(
      { _id: e._id, userId },
      { $set: { status: "skipped", skipReason: reason } },
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "skip",
        entity: "sipExecution",
        entityId: e._id,
        after: { reason },
      },
      session,
    );
    await refreshPending(ctx, await loadPlan(ctx, String(e.planId), session), session);
    return toExecutionDTO(ctx, { ...e, status: "skipped", skipReason: reason });
  });
}

/**
 * Undo: void every transaction of the execution's group (through the owner), reset the execution to
 * `due` — or `missed` when past its grace period — and re-plan what follows. Skips can be undone too.
 */
export async function undoSip(ctx: Ctx, id: string): Promise<ExecutionDTO> {
  return withTransaction(async (session) => {
    const userId = toObjectId(ctx.userId, "User");
    const e = await loadExecution(ctx, id, session);
    if (!["done", "partial", "skipped"].includes(e.status)) {
      throw new AppError("CONFLICT", "Nothing to undo for this period");
    }
    const plan = await loadPlan(ctx, String(e.planId), session);
    if (e.groupId) {
      const txns = await TransactionModel.find({ userId, groupId: e.groupId, status: "posted" })
        .session(session)
        .lean<TransactionDoc[]>();
      for (const t of txns) {
        await voidTransaction(ctx, String(t._id), "SIP execution undone", session, {
          viaOwner: true,
        });
      }
    }
    const due = keyOf(ctx, e.dueDate);
    const status: ExecutionStatus = isMissed("due", due, plan.graceDays, todayOf(ctx))
      ? "missed"
      : "due";
    const $set = {
      status,
      actualTotalMinor: 0,
      executedAt: null,
      onTime: null,
      groupId: null,
      skipReason: null,
      lines: e.lines.map((l) => ({
        ...l,
        actualMinor: 0,
        feeMinor: 0,
        units: null,
        priceMinorE4: null,
        transactionId: null,
      })),
    };
    await SipExecutionModel.updateOne({ _id: e._id, userId }, { $set }, { session });
    await writeAudit(
      {
        userId: ctx.userId,
        action: "undo",
        entity: "sipExecution",
        entityId: e._id,
        before: { status: e.status },
      },
      session,
    );
    await refreshPending(ctx, plan, session);
    return toExecutionDTO(ctx, { ...e, ...$set });
  });
}
