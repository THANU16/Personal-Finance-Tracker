import "server-only";
import { randomBytes } from "node:crypto";
import {
  ATTACHMENT_TYPES,
  AttachmentModel,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDoc,
  type AttachmentType,
} from "@/modules/attachments/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";
import { getStorage } from "@/server/storage";

// docs/02 — receipts on transactions: type and size validated (declared type AND file signature),
// stored by a random key under the user's id, served only through the authenticated route.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");

export interface AttachmentDTO {
  id: string;
  fileName: string;
  mimeType: AttachmentType;
  sizeBytes: number;
  createdAt: string;
  url: string;
}

const toDTO = (a: AttachmentDoc): AttachmentDTO => ({
  id: String(a._id),
  fileName: a.fileName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  createdAt: a.createdAt.toISOString(),
  url: `/api/files/${String(a._id)}`,
});

/** The type the bytes really are (by signature), or null. */
export function sniffType(b: Uint8Array): AttachmentType | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/** Keeps a readable, header-safe file name. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || "file";
}

async function ownedTransaction(ctx: Ctx, transactionId: string): Promise<TransactionDoc> {
  const t = await TransactionModel.findOne({
    _id: toObjectId(transactionId, "Transaction"),
    userId: uid(ctx),
  }).lean<TransactionDoc>();
  if (!t) throw new AppError("NOT_FOUND", "Transaction not found");
  return t;
}

export async function uploadAttachment(
  ctx: Ctx,
  input: { transactionId: string; fileName: string; mimeType: string; bytes: Uint8Array },
): Promise<AttachmentDTO> {
  await connectDb();
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new AppError("VALIDATION", "Only JPEG, PNG, WebP images and PDF files can be attached");
  }
  if (input.bytes.byteLength === 0) throw new AppError("VALIDATION", "The file is empty");
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AppError("VALIDATION", "Files can be at most 10 MB");
  }
  if (sniffType(input.bytes) !== input.mimeType) {
    throw new AppError("VALIDATION", "The file content does not match its type");
  }
  const txn = await ownedTransaction(ctx, input.transactionId);
  if ((txn.attachmentIds?.length ?? 0) >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    throw new AppError(
      "VALIDATION",
      `At most ${MAX_ATTACHMENTS_PER_TRANSACTION} files per transaction`,
    );
  }
  const storageKey = `${ctx.userId}/${randomBytes(18).toString("base64url")}`;
  const storage = getStorage();
  await storage.put(storageKey, input.bytes, input.mimeType);
  try {
    const doc = await AttachmentModel.create({
      userId: uid(ctx),
      storageKey,
      fileName: cleanFileName(input.fileName),
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      transactionId: txn._id,
    });
    await TransactionModel.updateOne(
      { _id: txn._id, userId: uid(ctx) },
      { $addToSet: { attachmentIds: doc._id } },
    );
    return toDTO(doc.toObject());
  } catch (err) {
    await storage.delete(storageKey).catch(() => undefined);
    throw err;
  }
}

export async function listAttachments(ctx: Ctx, transactionId: string): Promise<AttachmentDTO[]> {
  await connectDb();
  const docs = await AttachmentModel.find({
    userId: uid(ctx),
    transactionId: toObjectId(transactionId, "Transaction"),
  })
    .sort({ createdAt: 1 })
    .lean<AttachmentDoc[]>();
  return docs.map(toDTO);
}

/** For the download route: the owner's file only (null when it is not theirs or is gone). */
export async function readAttachment(
  ctx: Ctx,
  id: string,
): Promise<{ fileName: string; mimeType: AttachmentType; bytes: Uint8Array } | null> {
  await connectDb();
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  const doc = await AttachmentModel.findOne({
    _id: toObjectId(id, "Attachment"),
    userId: uid(ctx),
  }).lean<AttachmentDoc>();
  if (!doc) return null;
  const bytes = await getStorage().get(doc.storageKey);
  return bytes ? { fileName: doc.fileName, mimeType: doc.mimeType, bytes } : null;
}

/** Removes the file, the record and the link on the transaction. */
export async function deleteAttachment(ctx: Ctx, id: string): Promise<{ id: string }> {
  await connectDb();
  const doc = await AttachmentModel.findOneAndDelete({
    _id: toObjectId(id, "Attachment"),
    userId: uid(ctx),
  }).lean<AttachmentDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Attachment not found");
  if (doc.transactionId) {
    await TransactionModel.updateOne(
      { _id: doc.transactionId, userId: uid(ctx) },
      { $pull: { attachmentIds: doc._id } },
    );
  }
  await getStorage().delete(doc.storageKey);
  return { id };
}
