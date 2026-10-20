import { Schema, type Types } from "mongoose";
import {
  NOTIFICATION_TYPES,
  SEVERITIES,
  type NotificationType,
  type Severity,
} from "@/domain/notifications";
import { userScopedModel } from "@/server/db/model";

// docs/03 — notifications. Raised by the daily job (docs/04 §19); `dedupeKey` is unique per user
// so running the job again inserts nothing.

export interface NotificationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  dueDate: string | null;
  severity: Severity;
  dedupeKey: string;
  readAt: Date | null;
  snoozedUntil: Date | null;
  emailedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "/notifications" },
    dueDate: { type: String, default: null },
    severity: { type: String, enum: SEVERITIES, required: true, default: "info" },
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
    snoozedUntil: { type: Date, default: null },
    emailedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

export const NotificationModel = userScopedModel<NotificationDoc>(
  "Notification",
  notificationSchema,
  "notifications",
);
