import "server-only";
import type { ClientSession, Types } from "mongoose";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import { toObjectId } from "@/server/db/ids";

/**
 * Repairs categories duplicated by an earlier, non-idempotent first-login seed: categories with the
 * same kind, parent and name (case-insensitive) merge into one. The keeper is the active copy
 * created first; transactions, split lines and sub-categories of the others move to it, then the
 * duplicates are deleted (categories are not ledger records). Top level first, so children of
 * merged parents are compared under their new parent. Returns how many were merged.
 */
export async function mergeDuplicateCategories(
  userId: string,
  session: ClientSession,
): Promise<number> {
  const uid = toObjectId(userId, "User");
  let merged = 0;
  for (const level of ["top", "child"] as const) {
    const docs = await CategoryModel.find({
      userId: uid,
      isSystem: false,
      parentId: level === "top" ? null : { $ne: null },
    })
      .session(session)
      .lean<CategoryDoc[]>();
    const groups = new Map<string, CategoryDoc[]>();
    for (const d of docs) {
      const key = `${d.kind}|${d.parentId ? String(d.parentId) : ""}|${d.name.trim().toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort(
        (a, b) =>
          Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          String(a._id).localeCompare(String(b._id)),
      );
      const [keep, ...dups] = group as [CategoryDoc, ...CategoryDoc[]];
      for (const dup of dups) await mergeInto(uid, keep, dup, session);
      merged += dups.length;
      await writeAudit(
        {
          userId,
          action: "merge_duplicates",
          entity: "category",
          entityId: keep._id,
          before: dups.map((d) => String(d._id)),
        },
        session,
      );
    }
  }
  return merged;
}

async function mergeInto(
  userId: Types.ObjectId,
  keep: CategoryDoc,
  dup: CategoryDoc,
  session: ClientSession,
): Promise<void> {
  await TransactionModel.updateMany(
    { userId, categoryId: dup._id },
    { $set: { categoryId: keep._id } },
    { session },
  );
  await TransactionModel.updateMany(
    { userId, "splits.categoryId": dup._id },
    { $set: { "splits.$[line].categoryId": keep._id } },
    { session, arrayFilters: [{ "line.categoryId": dup._id }] },
  );
  // A split may now name the keeper twice: combine those lines (the total is unchanged).
  const affected = await TransactionModel.find({ userId, "splits.categoryId": keep._id })
    .session(session)
    .lean<TransactionDoc[]>();
  for (const t of affected) {
    const lines = new Map<
      string,
      { categoryId: Types.ObjectId; amountMinor: number; note: string | null }
    >();
    for (const line of t.splits) {
      const key = String(line.categoryId);
      const prev = lines.get(key);
      if (prev) {
        prev.amountMinor += line.amountMinor;
        prev.note = [prev.note, line.note].filter(Boolean).join("; ") || null;
      } else {
        lines.set(key, {
          categoryId: line.categoryId,
          amountMinor: line.amountMinor,
          note: line.note ?? null,
        });
      }
    }
    if (lines.size === t.splits.length) continue;
    const combined = [...lines.values()];
    await TransactionModel.updateOne(
      { _id: t._id, userId },
      combined.length === 1
        ? { $set: { splits: [], categoryId: combined[0]!.categoryId } }
        : { $set: { splits: combined } },
      { session },
    );
  }
  await CategoryModel.updateMany(
    { userId, parentId: dup._id },
    { $set: { parentId: keep._id } },
    { session },
  );
  if (dup.isEssential && !keep.isEssential) {
    await CategoryModel.updateOne(
      { _id: keep._id, userId },
      { $set: { isEssential: true } },
      { session },
    );
  }
  await CategoryModel.deleteOne({ _id: dup._id, userId }, { session });
}
