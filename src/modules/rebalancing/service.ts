import "server-only";
import { z } from "zod";
import { utcToBusinessDate } from "@/domain/dates";
import {
  cashflowPlan,
  computeDrift,
  fullRebalance,
  type DriftHolding,
  type DriftResult,
  type TradeLine,
} from "@/domain/drift";
import { computeNetWorthAsOf } from "@/domain/series";
import type { AllocationTree } from "@/domain/allocation";
import { getTarget, getTreeOptions, listTargetHistory } from "@/modules/allocation/service";
import type { TargetDTO, TreeOptions } from "@/modules/allocation/schemas";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import {
  SipExecutionModel,
  SipPlanModel,
  type SipExecutionDoc,
  type SipPlanDoc,
} from "@/modules/sip/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";

// docs/04 §8, docs/05 §7 — drift, full and cashflow rebalance on base-currency values today.

export interface HoldingRef {
  id: string;
  name: string;
  assetClassId: string;
  currency: string;
  isFd: boolean;
}

interface Loaded {
  target: TargetDTO;
  options: TreeOptions;
  holdings: DriftHolding[];
  refs: Map<string, HoldingRef>;
  fxMissing: number;
  today: string;
}

/** Holding values today in base (same single pass as the dashboard; FDs via §9). */
async function load(ctx: Ctx): Promise<Loaded> {
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const [input, target, options] = await Promise.all([
    loadSeriesInput(ctx),
    getTarget(ctx),
    getTreeOptions(ctx),
  ]);
  const point = computeNetWorthAsOf(input, today);
  const holdings: DriftHolding[] = input.holdingDocs.map((h) => ({
    id: String(h._id),
    assetClassId: String(h.assetClassId),
    valueMinor: point.byHolding[String(h._id)] ?? 0,
    active: h.status === "active",
    countsTowardEmergencyFund: h.countsTowardEmergencyFund,
    isFd: Boolean(h.fd),
  }));
  const refs = new Map(
    input.holdingDocs.map((h) => [
      String(h._id),
      {
        id: String(h._id),
        name: h.name,
        assetClassId: String(h.assetClassId),
        currency: h.currency,
        isFd: Boolean(h.fd),
      },
    ]),
  );
  return { target, options, holdings, refs, fxMissing: point.fxMissing, today };
}

export interface NextSip {
  planId: string;
  planName: string;
  executionId: string;
  dueDate: string;
  useTilt: boolean;
}

export interface AllocationView {
  currency: string;
  target: TargetDTO;
  options: TreeOptions;
  holdings: HoldingRef[];
  drift: DriftResult;
  trades: TradeLine[];
  fxMissing: number;
  nextSips: NextSip[];
}

async function nextSips(ctx: Ctx): Promise<NextSip[]> {
  const userId = toObjectId(ctx.userId, "User");
  const [plans, due] = await Promise.all([
    SipPlanModel.find({ userId, status: "active" }).lean<SipPlanDoc[]>(),
    SipExecutionModel.find({ userId, status: "due" })
      .sort({ dueDate: 1 })
      .lean<SipExecutionDoc[]>(),
  ]);
  return plans.flatMap((p) => {
    const e = due.find((x) => String(x.planId) === String(p._id));
    return e
      ? [
          {
            planId: String(p._id),
            planName: p.name,
            executionId: String(e._id),
            dueDate: utcToBusinessDate(e.dueDate, ctx.tz),
            useTilt: e.useTilt ?? false,
          },
        ]
      : [];
  });
}

export async function getAllocationView(
  ctx: Ctx,
  opts: { includeEmergency?: boolean } = {},
): Promise<AllocationView & { includeEmergency: boolean; emergencyCount: number }> {
  const l = await load(ctx);
  const tree = l.target.allocation;
  const o = { includeEmergency: Boolean(opts.includeEmergency) };
  return {
    currency: ctx.baseCurrency,
    target: l.target,
    options: l.options,
    holdings: [...l.refs.values()],
    drift: computeDrift(tree, l.holdings, l.target.thresholdBp, o),
    trades: fullRebalance(tree, l.holdings, o),
    includeEmergency: o.includeEmergency,
    emergencyCount: l.holdings.filter(
      (h) => h.active && h.countsTowardEmergencyFund && h.valueMinor > 0,
    ).length,
    fxMissing: l.fxMissing,
    nextSips: await nextSips(ctx),
  };
}

/** Number of target classes beyond the threshold (dashboard Attention). */
export async function countOffTarget(ctx: Ctx): Promise<number> {
  const l = await load(ctx);
  if (l.target.allocation.length === 0) return 0;
  return computeDrift(l.target.allocation, l.holdings, l.target.thresholdBp).flaggedCount;
}

const amountSchema = z
  .number()
  .int()
  .min(1, "Enter an amount above zero")
  .max(Number.MAX_SAFE_INTEGER);

/** "Invest new money": suggested buys for an amount (cashflow rebalance; only buys). */
export async function getCashflowPlan(
  ctx: Ctx,
  amount: unknown,
  opts: { includeEmergency?: boolean } = {},
): Promise<{ assetClassId: string; holdingId: string | null; amountMinor: number }[]> {
  const S = parseInput(amountSchema, amount);
  const l = await load(ctx);
  if (l.target.allocation.length === 0)
    throw new AppError("VALIDATION", "Set your target allocation first");
  return cashflowPlan(S, l.target.allocation, l.holdings, {
    includeEmergency: Boolean(opts.includeEmergency),
  });
}

/** "Use for next SIP": the plan's next due period opens in the drift-tilted split. */
export async function tiltNextSip(ctx: Ctx, planId: unknown): Promise<NextSip> {
  const id = parseInput(z.string().regex(/^[a-f0-9]{24}$/i, "Choose a plan"), planId);
  const userId = toObjectId(ctx.userId, "User");
  const plan = await SipPlanModel.findOne({
    _id: toObjectId(id, "Plan"),
    userId,
  }).lean<SipPlanDoc>();
  if (!plan) throw new AppError("NOT_FOUND", "SIP plan not found");
  const next = await SipExecutionModel.findOneAndUpdate(
    { userId, planId: plan._id, status: "due" },
    { $set: { useTilt: true } },
    { sort: { dueDate: 1 }, returnDocument: "after", lean: true },
  );
  if (!next) throw new AppError("CONFLICT", "This plan has no upcoming period");
  await writeAudit({
    userId: ctx.userId,
    action: "use_tilt",
    entity: "sipExecution",
    entityId: next._id,
  });
  return {
    planId: id,
    planName: plan.name,
    executionId: String(next._id),
    dueDate: utcToBusinessDate(next.dueDate, ctx.tz),
    useTilt: true,
  };
}

export interface HistoryEntry {
  id: string;
  savedAt: string;
  thresholdBp: number;
  note: string | null;
  allocation: AllocationTree;
  /** Changes against the previous save (oldest entry: everything "added"). */
  diff: {
    classes: { assetClassId: string; fromBp: number | null; toBp: number | null }[];
    holdingsAdded: string[];
    holdingsRemoved: string[];
    thresholdFromBp: number | null;
  };
}

function diffTrees(
  prev: AllocationTree | null,
  next: AllocationTree,
  prevThreshold: number | null,
  threshold: number,
) {
  const before = new Map((prev ?? []).map((c) => [c.assetClassId, c.percentBp]));
  const after = new Map(next.map((c) => [c.assetClassId, c.percentBp]));
  const classes = [...new Set([...before.keys(), ...after.keys()])]
    .map((id) => ({
      assetClassId: id,
      fromBp: before.get(id) ?? null,
      toBp: after.get(id) ?? null,
    }))
    .filter((c) => c.fromBp !== c.toBp);
  const holdingsOf = (t: AllocationTree | null) =>
    new Set((t ?? []).flatMap((c) => c.assets.map((a) => a.holdingId)));
  const hb = holdingsOf(prev);
  const ha = holdingsOf(next);
  return {
    classes,
    holdingsAdded: [...ha].filter((h) => !hb.has(h)),
    holdingsRemoved: [...hb].filter((h) => !ha.has(h)),
    thresholdFromBp: prevThreshold !== null && prevThreshold !== threshold ? prevThreshold : null,
  };
}

export async function getTargetHistory(ctx: Ctx, limit = 30): Promise<HistoryEntry[]> {
  const rows = await listTargetHistory(ctx, limit + 1); // newest first; one extra for the last diff
  return rows.slice(0, limit).map((r, i) => {
    const prev = rows[i + 1] ?? null;
    return {
      id: r.id,
      savedAt: r.savedAt,
      thresholdBp: r.thresholdBp,
      note: r.note,
      allocation: r.allocation,
      diff: diffTrees(
        prev?.allocation ?? null,
        r.allocation,
        prev?.thresholdBp ?? null,
        r.thresholdBp,
      ),
    };
  });
}
