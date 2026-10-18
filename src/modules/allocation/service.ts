import "server-only";
import { Types, type ClientSession } from "mongoose";
import { validateTree, type AllocationTree, type TreeHoldingInfo } from "@/domain/allocation";
import {
  TargetAllocationHistoryModel,
  TargetAllocationModel,
  type AllocationTreeDoc,
  type TargetAllocationDoc,
  type TargetAllocationHistoryDoc,
} from "@/modules/allocation/model";
import {
  saveTargetSchema,
  type TargetDTO,
  type TargetHistoryDTO,
  type TreeOptions,
} from "@/modules/allocation/schemas";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";

// docs/04 §6 — the single planned allocation (target). SIP plans and opportunity deployments
// default to it; saving it writes targetAllocationHistory.

export function treeFromDoc(doc: readonly AllocationTreeDoc[] | null | undefined): AllocationTree {
  return (doc ?? []).map((c) => ({
    assetClassId: String(c.assetClassId),
    percentBp: c.percentBp,
    assets: (c.assets ?? []).map((a) => ({
      holdingId: String(a.holdingId),
      percentBp: a.percentBp,
    })),
  }));
}

export function treeToDoc(tree: AllocationTree): AllocationTreeDoc[] {
  return tree.map((c) => ({
    assetClassId: new Types.ObjectId(c.assetClassId),
    percentBp: c.percentBp,
    assets: c.assets.map((a) => ({
      holdingId: new Types.ObjectId(a.holdingId),
      percentBp: a.percentBp,
    })),
  }));
}

/** Holdings as the validator sees them (all statuses, so closed ones are reported). */
export async function treeHoldingInfo(
  ctx: Ctx,
  session?: ClientSession,
): Promise<TreeHoldingInfo[]> {
  const q = HoldingModel.find({ userId: toObjectId(ctx.userId, "User") });
  if (session) q.session(session);
  const docs = await q.lean<HoldingDoc[]>();
  return docs.map((h) => ({
    id: String(h._id),
    assetClassId: String(h.assetClassId),
    active: h.status === "active",
  }));
}

/**
 * Validates a tree against the user's classes and holdings; throws VALIDATION with the first
 * problems as field errors. `requireAssets` for trees that must name holdings (SIP custom).
 */
export async function assertValidTree(
  ctx: Ctx,
  tree: AllocationTree,
  opts: { requireAssets?: boolean; session?: ClientSession } = {},
): Promise<string[]> {
  const userId = toObjectId(ctx.userId, "User");
  const q = AssetClassModel.find({ userId, archivedAt: null });
  if (opts.session) q.session(opts.session);
  const classes = new Set((await q.lean<AssetClassDoc[]>()).map((c) => String(c._id)));
  const unknown = tree.find((c) => !classes.has(c.assetClassId));
  if (unknown)
    throw new AppError("VALIDATION", "Unknown or archived asset class", {
      allocation: ["Unknown asset class"],
    });
  const result = validateTree(tree, await treeHoldingInfo(ctx, opts.session), {
    requireAssets: opts.requireAssets,
  });
  if (result.errors.length) {
    throw new AppError("VALIDATION", result.errors[0]!.message, {
      allocation: result.errors.map((e) => e.message),
    });
  }
  return result.warnings.map((w) => w.message);
}

function toDTO(doc: TargetAllocationDoc | null): TargetDTO {
  return {
    allocation: treeFromDoc(doc?.allocation),
    thresholdBp: doc?.thresholdBp ?? 500,
    updatedAt: doc ? doc.updatedAt.toISOString() : null,
  };
}

export async function getTarget(ctx: Ctx, session?: ClientSession): Promise<TargetDTO> {
  await connectDb();
  const q = TargetAllocationModel.findOne({ userId: toObjectId(ctx.userId, "User") });
  if (session) q.session(session);
  return toDTO(await q.lean<TargetAllocationDoc>());
}

/**
 * Saves the target and a history row; then pending SIP executions that follow the target are
 * re-planned (future executions only — executed ones keep the tree they used).
 */
export async function saveTarget(
  ctx: Ctx,
  input: unknown,
): Promise<TargetDTO & { warnings: string[] }> {
  const data = parseInput(saveTargetSchema, input);
  return withTransaction(async (session) => {
    const warnings = await assertValidTree(ctx, data.allocation, { session });
    const userId = toObjectId(ctx.userId, "User");
    const allocation = treeToDoc(data.allocation);
    const doc = await TargetAllocationModel.findOneAndUpdate(
      { userId },
      { $set: { allocation, thresholdBp: data.thresholdBp } },
      { upsert: true, returnDocument: "after", session, lean: true },
    );
    await TargetAllocationHistoryModel.create(
      [{ userId, allocation, thresholdBp: data.thresholdBp, note: data.note ?? null }],
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "save",
        entity: "targetAllocation",
        entityId: doc!._id,
        after: data,
      },
      session,
    );
    const { refreshTargetFollowers } = await import("@/modules/sip/service");
    await refreshTargetFollowers(ctx, session);
    return { ...toDTO(doc as TargetAllocationDoc), warnings };
  });
}

export async function listTargetHistory(ctx: Ctx, limit = 20): Promise<TargetHistoryDTO[]> {
  await connectDb();
  const docs = await TargetAllocationHistoryModel.find({ userId: toObjectId(ctx.userId, "User") })
    .sort({ savedAt: -1 })
    .limit(limit)
    .lean<TargetAllocationHistoryDoc[]>();
  return docs.map((d) => ({
    id: String(d._id),
    savedAt: d.savedAt.toISOString(),
    thresholdBp: d.thresholdBp,
    allocation: treeFromDoc(d.allocation),
    note: d.note ?? null,
  }));
}

/** Classes and holdings for the tree editor (active classes; holdings incl. their currency). */
export async function getTreeOptions(ctx: Ctx): Promise<TreeOptions> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const [classes, holdings] = await Promise.all([
    AssetClassModel.find({ userId, archivedAt: null })
      .sort({ sortOrder: 1, name: 1 })
      .lean<AssetClassDoc[]>(),
    HoldingModel.find({ userId }).sort({ name: 1 }).lean<HoldingDoc[]>(),
  ]);
  return {
    classes: classes.map((c) => ({ id: String(c._id), name: c.name, color: c.color })),
    holdings: holdings.map((h) => ({
      id: String(h._id),
      name: h.name,
      assetClassId: String(h.assetClassId),
      currency: h.currency,
      active: h.status === "active",
    })),
  };
}
