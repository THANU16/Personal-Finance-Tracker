import "server-only";
import { z } from "zod";
import type { NotificationDraft, NotificationType, Severity } from "@/domain/notifications";
import { NotificationModel, type NotificationDoc } from "@/modules/notifications/model";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";

// docs/04 §19 — notifications are raised by the daily job and are idempotent by `dedupeKey`
// (unique per user): raising the same key again changes nothing. They are not financial records.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  dueDate: string | null;
  severity: Severity;
  createdAt: string;
  read: boolean;
}

function toDTO(d: NotificationDoc): NotificationDTO {
  return {
    id: String(d._id),
    type: d.type,
    title: d.title,
    body: d.body,
    link: d.link,
    dueDate: d.dueDate ?? null,
    severity: d.severity,
    createdAt: d.createdAt.toISOString(),
    read: Boolean(d.readAt),
  };
}

/** Inserts drafts whose dedupe key is new; returns how many were inserted. */
export async function raiseNotifications(
  ctx: Ctx,
  drafts: readonly NotificationDraft[],
): Promise<number> {
  if (!drafts.length) return 0;
  await connectDb();
  const userId = uid(ctx);
  const unique = [...new Map(drafts.map((d) => [d.dedupeKey, d])).values()];
  const res = await NotificationModel.bulkWrite(
    unique.map((d) => ({
      updateOne: {
        filter: { userId, dedupeKey: d.dedupeKey },
        update: {
          $setOnInsert: {
            userId,
            dedupeKey: d.dedupeKey,
            type: d.type,
            title: d.title,
            body: d.body,
            link: d.link,
            dueDate: d.dueDate,
            severity: d.severity,
            readAt: null,
            snoozedUntil: null,
            emailedAt: null,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return res.upsertedCount;
}

/**
 * Removes notifications of a "state" type whose condition no longer holds (over_earmarked), so the
 * same key can be raised again if it comes back.
 */
export async function clearResolved(
  ctx: Ctx,
  type: NotificationType,
  activeKeys: readonly string[],
): Promise<number> {
  const res = await NotificationModel.deleteMany({
    userId: uid(ctx),
    type,
    dedupeKey: { $nin: activeKeys },
  });
  return res.deletedCount;
}

const visible = (now: Date) => ({ $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }] });

/** Newest first; snoozed ones are hidden until their time. */
export async function listNotifications(ctx: Ctx, limit = 200): Promise<NotificationDTO[]> {
  await connectDb();
  const docs = await NotificationModel.find({ userId: uid(ctx), ...visible(new Date()) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<NotificationDoc[]>();
  return docs.map(toDTO);
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  await connectDb();
  return NotificationModel.countDocuments({
    userId: uid(ctx),
    readAt: null,
    ...visible(new Date()),
  });
}

export async function markRead(ctx: Ctx, id: string): Promise<{ id: string }> {
  await connectDb();
  const res = await NotificationModel.updateOne(
    { _id: toObjectId(id, "Notification"), userId: uid(ctx) },
    { $set: { readAt: new Date() } },
  );
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND", "Notification not found");
  return { id };
}

export async function markAllRead(ctx: Ctx): Promise<{ updated: number }> {
  await connectDb();
  const res = await NotificationModel.updateMany(
    { userId: uid(ctx), readAt: null },
    { $set: { readAt: new Date() } },
  );
  return { updated: res.modifiedCount };
}

export const SNOOZE_DAYS = [1, 3, 7] as const;
const snoozeSchema = z.union([z.literal(1), z.literal(3), z.literal(7)]);

/** Hides the notification for 1, 3 or 7 days; it comes back unread. */
export async function snooze(
  ctx: Ctx,
  id: string,
  days: unknown,
): Promise<{ id: string; until: string }> {
  const d = parseInput(snoozeSchema, days);
  await connectDb();
  const until = new Date(Date.now() + d * 86_400_000);
  const res = await NotificationModel.updateOne(
    { _id: toObjectId(id, "Notification"), userId: uid(ctx) },
    { $set: { snoozedUntil: until, readAt: null } },
  );
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND", "Notification not found");
  return { id, until: until.toISOString() };
}

/** Unread notifications not emailed yet (daily digest). */
export async function pendingEmail(ctx: Ctx): Promise<NotificationDoc[]> {
  return NotificationModel.find({ userId: uid(ctx), readAt: null, emailedAt: null })
    .sort({ createdAt: 1 })
    .lean<NotificationDoc[]>();
}

export async function markEmailed(ctx: Ctx, ids: readonly NotificationDoc["_id"][]): Promise<void> {
  if (!ids.length) return;
  await NotificationModel.updateMany(
    { userId: uid(ctx), _id: { $in: ids } },
    { $set: { emailedAt: new Date() } },
  );
}
