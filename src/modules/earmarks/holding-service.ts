import "server-only";
import type { ClientSession, Types } from "mongoose";
import { z } from "zod";
import { utcToBusinessDate } from "@/domain/dates";
import {
  BUCKETS,
  BUCKET_SLOTS,
  effectiveEarmarks,
  moveBetweenBuckets as planMove,
  rawEarmark,
  type Bucket,
  type BucketAmounts,
  type EarmarkMode,
  type EffectiveEarmarks,
} from "@/domain/earmarks";
import { fdValue } from "@/domain/fd";
import { HoldingEarmarkModel, type HoldingEarmarkDoc } from "@/modules/earmarks/holding-model";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { fdTerms } from "@/server/ledger/holding-events";

// Holding earmarks (owner request): docs/04 §20 rules on a holding's value today (FDs via §9).
// A holding flagged "counts toward emergency fund" is emergency money as a whole and carries none.

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
const positiveMinor = z
  .number()
  .int("Must be a whole amount")
  .min(1, "Enter an amount above zero")
  .max(Number.MAX_SAFE_INTEGER);
const note = z.string().trim().max(200).nullish();

export const setHoldingEarmarkSchema = z.discriminatedUnion("mode", [
  z
    .object({
      holdingId: objectId,
      bucket: z.enum(BUCKETS),
      mode: z.literal("fixed"),
      amountMinor: positiveMinor,
      note,
    })
    .strict(),
  z
    .object({
      holdingId: objectId,
      bucket: z.enum(BUCKETS),
      mode: z.literal("percent"),
      percentBp: z
        .number()
        .int("Use whole basis points")
        .min(1, "Enter a percentage above zero")
        .max(10_000, "At most 100%"),
      note,
    })
    .strict(),
]);
export const removeHoldingEarmarkSchema = z
  .object({ holdingId: objectId, bucket: z.enum(BUCKETS) })
  .strict();
export const moveHoldingBucketsSchema = z
  .object({
    holdingId: objectId,
    from: z.enum(BUCKET_SLOTS),
    to: z.enum(BUCKET_SLOTS),
    amountMinor: positiveMinor,
  })
  .strict()
  .refine((v) => v.from !== v.to, { path: ["to"], message: "Choose a different bucket" });

export interface HoldingEarmarkDTO {
  id: string;
  bucket: Bucket;
  mode: EarmarkMode;
  amountMinor: number | null;
  percentBp: number | null;
  note: string | null;
  rawMinor: number;
}

/** Buckets of one holding (value today in its own currency). */
export interface HoldingBucketsDTO extends EffectiveEarmarks {
  holdingId: string;
  name: string;
  currency: string;
  /** The holding's value today (the "balance" the earmarks apply to). */
  balanceMinor: number;
  active: boolean;
  liquidity: HoldingDoc["liquidity"];
  /** Active and not flagged as emergency money as a whole. */
  canCarryEarmarks: boolean;
  dedicated: "emergency" | null;
  earmarks: HoldingEarmarkDTO[];
}

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");

/** The holding's value today: FDs with terms by §9, others the cached value. */
export function holdingValueToday(h: HoldingDoc, tz: string): number {
  if (h.status !== "active") return 0;
  const terms = fdTerms(h, tz);
  return terms ? fdValue(terms, utcToBusinessDate(new Date(), tz)) : h.currentValueMinor;
}

export const canCarryHoldingEarmarks = (
  h: Pick<HoldingDoc, "status" | "countsTowardEmergencyFund">,
) => h.status === "active" && !h.countsTowardEmergencyFund;

function toDTO(h: HoldingDoc, earmarks: HoldingEarmarkDoc[], tz: string): HoldingBucketsDTO {
  const value = holdingValueToday(h, tz);
  const carry = canCarryHoldingEarmarks(h);
  const eff = carry
    ? effectiveEarmarks(value, earmarks)
    : {
        emergencyMinor: h.countsTowardEmergencyFund ? Math.max(0, value) : 0,
        opportunityMinor: 0,
        freeMinor: h.countsTowardEmergencyFund ? 0 : value,
        overEarmarked: false,
      };
  return {
    ...eff,
    holdingId: String(h._id),
    name: h.name,
    currency: h.currency,
    balanceMinor: value,
    active: h.status === "active",
    liquidity: h.liquidity,
    canCarryEarmarks: carry,
    dedicated: h.countsTowardEmergencyFund ? "emergency" : null,
    earmarks: (carry ? earmarks : [])
      .slice()
      .sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket))
      .map((e) => ({
        id: String(e._id),
        bucket: e.bucket,
        mode: e.mode,
        amountMinor: e.amountMinor ?? null,
        percentBp: e.percentBp ?? null,
        note: e.note ?? null,
        rawMinor: rawEarmark(value, e),
      })),
  };
}

export async function holdingEarmarksOf(
  userId: Types.ObjectId,
  holdingId: Types.ObjectId,
  session?: ClientSession | null,
): Promise<HoldingEarmarkDoc[]> {
  const q = HoldingEarmarkModel.find({ userId, holdingId });
  if (session) q.session(session);
  return q.lean<HoldingEarmarkDoc[]>();
}

export async function hasHoldingEarmarks(
  userId: Types.ObjectId,
  holdingId: Types.ObjectId,
  session: ClientSession,
): Promise<boolean> {
  return (await HoldingEarmarkModel.exists({ userId, holdingId }).session(session)) !== null;
}

/** Effective earmarks of a holding (all free when it cannot carry any). Used by the sell guard. */
export async function effectiveHoldingEarmarksOf(
  holding: HoldingDoc,
  tz: string,
  session: ClientSession | null,
): Promise<EffectiveEarmarks> {
  const value = holdingValueToday(holding, tz);
  if (!canCarryHoldingEarmarks(holding)) {
    return { emergencyMinor: 0, opportunityMinor: 0, freeMinor: value, overEarmarked: false };
  }
  return effectiveEarmarks(value, await holdingEarmarksOf(holding.userId, holding._id, session));
}

/** Writes new fixed amounts per bucket (null = untouched; 0 removes). Audited. */
export async function storeHoldingBucketAmounts(
  ctx: Ctx,
  holding: HoldingDoc,
  amounts: BucketAmounts,
  reason: string,
  session: ClientSession,
): Promise<void> {
  const before = await holdingEarmarksOf(holding.userId, holding._id, session);
  for (const bucket of BUCKETS) {
    const next = bucket === "emergency" ? amounts.emergencyMinor : amounts.opportunityMinor;
    if (next === null) continue;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new AppError("INTERNAL", "Invalid earmark amount");
    }
    const filter = { userId: holding.userId, holdingId: holding._id, bucket };
    if (next === 0) await HoldingEarmarkModel.deleteOne(filter, { session });
    else
      await HoldingEarmarkModel.updateOne(
        filter,
        { $set: { mode: "fixed", amountMinor: next, percentBp: null } },
        { upsert: true, session, runValidators: true },
      );
  }
  await writeAudit(
    {
      userId: ctx.userId,
      action: reason,
      entity: "holdingEarmarks",
      entityId: holding._id,
      before: before.map((e) => ({
        bucket: e.bucket,
        mode: e.mode,
        amountMinor: e.amountMinor,
        percentBp: e.percentBp,
      })),
      after: amounts,
    },
    session,
  );
}

async function loadHolding(ctx: Ctx, id: string, session?: ClientSession): Promise<HoldingDoc> {
  const q = HoldingModel.findOne({ _id: toObjectId(id, "Holding"), userId: uid(ctx) });
  if (session) q.session(session);
  const h = await q.lean<HoldingDoc>();
  if (!h) throw new AppError("NOT_FOUND", "Holding not found");
  return h;
}

function assertCanCarry(h: HoldingDoc, tz: string) {
  if (h.countsTowardEmergencyFund) {
    throw new AppError(
      "VALIDATION",
      `"${h.name}" counts toward your emergency fund as a whole: all of it is emergency money already`,
    );
  }
  if (h.status !== "active") throw new AppError("CONFLICT", `"${h.name}" is closed`);
  if (holdingValueToday(h, tz) <= 0) {
    throw new AppError("VALIDATION", `"${h.name}" has no value to earmark; update its value first`);
  }
}

export async function getHoldingBuckets(ctx: Ctx, holdingId: string): Promise<HoldingBucketsDTO> {
  await connectDb();
  const h = await loadHolding(ctx, holdingId);
  return toDTO(h, await holdingEarmarksOf(h.userId, h._id), ctx.tz);
}

/** Buckets of every holding, keyed by holding id. */
export async function listHoldingBuckets(ctx: Ctx): Promise<Map<string, HoldingBucketsDTO>> {
  await connectDb();
  const [holdings, earmarks] = await Promise.all([
    HoldingModel.find({ userId: uid(ctx) }).lean<HoldingDoc[]>(),
    HoldingEarmarkModel.find({ userId: uid(ctx) }).lean<HoldingEarmarkDoc[]>(),
  ]);
  const byHolding = new Map<string, HoldingEarmarkDoc[]>();
  for (const e of earmarks) {
    const key = String(e.holdingId);
    byHolding.set(key, [...(byHolding.get(key) ?? []), e]);
  }
  return new Map(
    holdings.map((h) => [String(h._id), toDTO(h, byHolding.get(String(h._id)) ?? [], ctx.tz)]),
  );
}

/** Creates or replaces one bucket's earmark on a holding. Σ raw must fit in its value. */
export async function setHoldingEarmark(ctx: Ctx, input: unknown): Promise<HoldingBucketsDTO> {
  const data = parseInput(setHoldingEarmarkSchema, input);
  return withTransaction(async (session) => {
    const h = await loadHolding(ctx, data.holdingId, session);
    assertCanCarry(h, ctx.tz);
    const value = holdingValueToday(h, ctx.tz);
    const existing = await holdingEarmarksOf(h.userId, h._id, session);
    const next = {
      bucket: data.bucket,
      mode: data.mode,
      amountMinor: data.mode === "fixed" ? data.amountMinor : null,
      percentBp: data.mode === "percent" ? data.percentBp : null,
    };
    const total = [...existing.filter((e) => e.bucket !== data.bucket), next].reduce(
      (s, e) => s + rawEarmark(value, e),
      0,
    );
    if (total > value) {
      const field = data.mode === "fixed" ? "amountMinor" : "percentBp";
      const message = "Earmarks would be more than the holding's value";
      throw new AppError("VALIDATION", message, { [field]: [message] });
    }
    await HoldingEarmarkModel.updateOne(
      { userId: h.userId, holdingId: h._id, bucket: data.bucket },
      { $set: { ...next, note: data.note ?? null } },
      { upsert: true, session, runValidators: true },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "earmark_set",
        entity: "holdingEarmarks",
        entityId: h._id,
        after: next,
      },
      session,
    );
    return toDTO(h, await holdingEarmarksOf(h.userId, h._id, session), ctx.tz);
  });
}

export async function removeHoldingEarmark(ctx: Ctx, input: unknown): Promise<HoldingBucketsDTO> {
  const data = parseInput(removeHoldingEarmarkSchema, input);
  return withTransaction(async (session) => {
    const h = await loadHolding(ctx, data.holdingId, session);
    const res = await HoldingEarmarkModel.deleteOne(
      { userId: h.userId, holdingId: h._id, bucket: data.bucket },
      { session },
    );
    if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "That earmark does not exist");
    await writeAudit(
      {
        userId: ctx.userId,
        action: "earmark_remove",
        entity: "holdingEarmarks",
        entityId: h._id,
        before: { bucket: data.bucket },
      },
      session,
    );
    return toDTO(h, await holdingEarmarksOf(h.userId, h._id, session), ctx.tz);
  });
}

/** Moves value between free / emergency / opportunity inside one holding (nothing is sold). */
export async function moveHoldingBuckets(ctx: Ctx, input: unknown): Promise<HoldingBucketsDTO> {
  const data = parseInput(moveHoldingBucketsSchema, input);
  return withTransaction(async (session) => {
    const h = await loadHolding(ctx, data.holdingId, session);
    assertCanCarry(h, ctx.tz);
    const eff = await effectiveHoldingEarmarksOf(h, ctx.tz, session);
    let amounts: BucketAmounts;
    try {
      amounts = planMove(eff, data.from, data.to, data.amountMinor);
    } catch (err) {
      if (err instanceof RangeError) {
        throw new AppError("VALIDATION", "Not enough in that bucket", {
          amountMinor: [err.message],
        });
      }
      throw err;
    }
    await storeHoldingBucketAmounts(ctx, h, amounts, "earmark_move", session);
    return toDTO(h, await holdingEarmarksOf(h.userId, h._id, session), ctx.tz);
  });
}
