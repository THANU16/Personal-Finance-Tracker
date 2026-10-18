import "server-only";
import { Schema, type ClientSession, type Types } from "mongoose";
import { toObjectId } from "@/server/db/ids";
import { userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — auditLog. Written by the ledger engine and settings changes.
export interface AuditLogDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  action: string;
  entity: string;
  entityId: Types.ObjectId;
  before: unknown;
  after: unknown;
  at: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
  at: { type: Date, required: true, default: () => new Date() },
});

auditLogSchema.index({ userId: 1, entity: 1, entityId: 1, at: -1 });

export const AuditLogModel = userScopedModel<AuditLogDoc>("AuditLog", auditLogSchema, "auditLog");

export async function writeAudit(
  entry: {
    userId: string;
    action: string;
    entity: string;
    entityId: Types.ObjectId | string;
    before?: unknown;
    after?: unknown;
  },
  session?: ClientSession,
): Promise<void> {
  await AuditLogModel.create(
    [
      {
        userId: toObjectId(entry.userId, "User"),
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before ?? null,
        after: entry.after ?? null,
      },
    ],
    { session },
  );
}
