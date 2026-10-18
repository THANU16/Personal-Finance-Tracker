import "server-only";
import { Types } from "mongoose";
import type { AccountType } from "@/domain/accounts";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { buildBuckets } from "@/domain/date-range";
import { computeNetWorthSeries, type NetWorthPoint } from "@/domain/series";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import { SnapshotModel, type SnapshotDoc } from "@/modules/snapshots/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";

// docs/04 §16 — month-end snapshots are a CACHE of computeNetWorthSeries (FDs via §9).

export interface SnapshotPoint {
  date: string;
  kind: "auto" | "manual";
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  investedMinor: number;
  cashMinor: number;
  holdingsValueMinor: number;
  byClass: Record<string, number>;
  fxMissing: number;
}

function toFields(p: NetWorthPoint) {
  return {
    netWorthMinor: p.netWorthMinor,
    assetsMinor: p.assetsMinor,
    liabilitiesMinor: p.liabilitiesMinor,
    investedMinor: p.investedMinor,
    cashMinor: p.cashMinor,
    holdingsValueMinor: p.holdingsValueMinor,
    fxMissing: p.fxMissing,
    byClass: Object.entries(p.byClass).map(([id, valueMinor]) => ({
      assetClassId: new Types.ObjectId(id),
      valueMinor,
    })),
    byAccountType: Object.entries(p.byAccountType).map(([type, valueMinor]) => ({
      type: type as AccountType,
      valueMinor: valueMinor ?? 0,
    })),
  };
}

function toPoint(d: SnapshotDoc, tz: string): SnapshotPoint {
  return {
    date: utcToBusinessDate(d.date, tz),
    kind: d.kind,
    netWorthMinor: d.netWorthMinor,
    assetsMinor: d.assetsMinor,
    liabilitiesMinor: d.liabilitiesMinor,
    investedMinor: d.investedMinor,
    cashMinor: d.cashMinor,
    holdingsValueMinor: d.holdingsValueMinor ?? 0,
    byClass: Object.fromEntries(d.byClass.map((c) => [String(c.assetClassId), c.valueMinor])),
    fxMissing: d.fxMissing ?? 0,
  };
}

/** Month-end keys from the first month with data up to the last completed month. */
function completedMonthEnds(earliestKey: string | null, todayKey: string): string[] {
  if (!earliestKey) return [];
  const lastMonthEnd = buildBuckets({ from: earliestKey, to: todayKey }, "month")
    .map((b) => b.end)
    .filter((end) => end < todayKey && end.slice(0, 7) !== todayKey.slice(0, 7));
  return lastMonthEnd;
}

async function upsertAuto(ctx: Ctx, points: NetWorthPoint[]): Promise<number> {
  if (!points.length) return 0;
  const userId = toObjectId(ctx.userId, "User");
  await SnapshotModel.bulkWrite(
    points.map((p) => ({
      updateOne: {
        filter: { userId, kind: "auto", date: businessDateToUtc(p.date, ctx.tz) },
        update: { $set: toFields(p), $setOnInsert: { userId, kind: "auto" } },
        upsert: true,
      },
    })),
  );
  return points.length;
}

/**
 * "Rebuild history": recomputes every completed month-end in ONE pass and upserts them, and
 * removes auto snapshots outside that set (e.g. before the first data). Idempotent.
 */
export async function rebuildHistory(ctx: Ctx): Promise<{ months: number }> {
  const input = await loadSeriesInput(ctx);
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const ends = completedMonthEnds(input.earliestKey, today);
  const points = computeNetWorthSeries(input, ends);
  await upsertAuto(ctx, points);
  await SnapshotModel.deleteMany({
    userId: toObjectId(ctx.userId, "User"),
    kind: "auto",
    date: { $nin: ends.map((e) => businessDateToUtc(e, ctx.tz)) },
  });
  return { months: points.length };
}

/**
 * Job function (docs/04 §16, wired to the daily cron in Phase 10): on any day, makes sure the
 * previous month-end snapshot exists. Idempotent — safe to call on every run.
 */
export async function ensureMonthEndSnapshot(ctx: Ctx, todayKey?: string): Promise<boolean> {
  await connectDb();
  const today = todayKey ?? utcToBusinessDate(new Date(), ctx.tz);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const prevMonthEnd = utcToBusinessDate(
    new Date(Date.UTC(y, m - 1, 0, 12)), // day 0 = last day of previous month
    "UTC",
  );
  const userId = toObjectId(ctx.userId, "User");
  const exists = await SnapshotModel.exists({
    userId,
    kind: "auto",
    date: businessDateToUtc(prevMonthEnd, ctx.tz),
  });
  if (exists) return false;
  const input = await loadSeriesInput(ctx);
  if (!input.earliestKey || input.earliestKey > prevMonthEnd) return false;
  await upsertAuto(ctx, computeNetWorthSeries(input, [prevMonthEnd]));
  return true;
}

/** Manual snapshot = now (docs/04 §16). */
export async function createManualSnapshot(ctx: Ctx): Promise<SnapshotPoint> {
  const input = await loadSeriesInput(ctx);
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const [p] = computeNetWorthSeries(input, [today]);
  const [doc] = await SnapshotModel.create([
    {
      userId: toObjectId(ctx.userId, "User"),
      kind: "manual",
      date: businessDateToUtc(today, ctx.tz),
      ...toFields(p!),
    },
  ]);
  return toPoint(doc!.toObject() as SnapshotDoc, ctx.tz);
}

/** Auto month-end snapshots within [from, to] (keys), ascending. */
export async function listMonthEndSnapshots(
  ctx: Ctx,
  from: string,
  to: string,
): Promise<SnapshotPoint[]> {
  await connectDb();
  const docs = await SnapshotModel.find({
    userId: toObjectId(ctx.userId, "User"),
    kind: "auto",
    date: { $gte: businessDateToUtc(from, ctx.tz), $lte: businessDateToUtc(to, ctx.tz) },
  })
    .sort({ date: 1 })
    .lean<SnapshotDoc[]>();
  return docs.map((d) => toPoint(d, ctx.tz));
}
