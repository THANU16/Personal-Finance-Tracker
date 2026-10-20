import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 attachments — receipts on transactions; the bytes live in the StorageProvider.

export const ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;

export interface AttachmentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  storageKey: string;
  fileName: string;
  mimeType: AttachmentType;
  sizeBytes: number;
  transactionId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema<AttachmentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    storageKey: { type: String, required: true },
    fileName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, enum: ATTACHMENT_TYPES, required: true },
    sizeBytes: intField({ required: true, min: 1, max: MAX_ATTACHMENT_BYTES }),
    transactionId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
attachmentSchema.index({ userId: 1, transactionId: 1 });

export const AttachmentModel = userScopedModel<AttachmentDoc>(
  "Attachment",
  attachmentSchema,
  "attachments",
);
