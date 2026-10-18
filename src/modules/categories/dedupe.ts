import "server-only";
import type { ClientSession, Types } from "mongoose";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { writeAudit } from "@/server/audit/model";
import { toObjectId } from "@/server/db/ids";

/**
 * Repairs categories duplicated by an earlier first-login bug: categories with the same kind,
 * parent and name (case-insensitive; system and user categories separately) merge into one. The
 * keeper is the active copy created first; transactions, split lines and sub-categories of the
 * others move to it, then the copies are deleted (categories are not ledger records). Top level
 * first, so children of merged parents are compared under their new parent. Work is batched per
 * group (a few operations however many copies exist). Returns how many categories were removed.
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
      parentId: level === "top" ? null : { $ne: null },
    })
      .session(session)
      .lean<CategoryDoc[]>();
    const groups = new Map<string, CategoryDoc[]>();
    for (const d of docs) {
      const key = `${d.isSystem ? "sys" : "user"}|${d.kind}|${d.parentId ? String(d.parentId) : ""}|${d.name.trim().toLowerCase()}`;
      const list = groups.get(key);
      if (list) list.push(d);
      else groups.set(key, [d]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort(
        (a, b) =>
          Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) ||
          (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
          String(a._id).localeCompare(String(b._id)),
      );
      const [keep, ...dups] = group as [CategoryDoc, ...CategoryDoc[]];
      await mergeGroup(uid, keep, dups, session);
      merged += dups.length;
      await writeAudit(
        {
          userId,
          action: "merge_duplicates",
          entity: "category",
          entityId: keep._id,
          before: { removed: dups.length },
        },
        session,
      );
    }
  }
  return merged;
}

async function mergeGroup(
  userId: Types.ObjectId,
  keep: CategoryDoc,
  dups: CategoryDoc[],
  session: ClientSession,
): Promise<void> {
  const dupIds = dups.map((d) => d._id);
  await TransactionModel.updateMany(
    { userId, categoryId: { $in: dupIds } },
    { $set: { categoryId: keep._id } },
    { session },
  );
  await TransactionModel.updateMany(
    { userId, "splits.categoryId": { $in: dupIds } },
    { $set: { "splits.$[line].categoryId": keep._id } },
    { session, arrayFilters: [{ "line.categoryId": { $in: dupIds } }] },
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
    { userId, parentId: { $in: dupIds } },
    { $set: { parentId: keep._id } },
    { session },
  );
  if (!keep.isEssential && dups.some((d) => d.isEssential)) {
    await CategoryModel.updateOne(
      { _id: keep._id, userId },
      { $set: { isEssential: true } },
      { session },
    );
  }
  await CategoryModel.deleteMany({ userId, _id: { $in: dupIds } }, { session });
}
