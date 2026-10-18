import "server-only";
import type { ClientSession, Types } from "mongoose";
import { CategoryModel, type CategoryDoc, type CategoryKind } from "@/modules/categories/model";
import {
  createCategorySchema,
  updateCategorySchema,
  type CategoryDTO,
  type CategoryNode,
} from "@/modules/categories/schemas";
import { STARTER_CATEGORIES, SYSTEM_CATEGORIES } from "@/modules/categories/seed";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";

export function toCategoryDTO(doc: CategoryDoc): CategoryDTO {
  return {
    id: String(doc._id),
    name: doc.name,
    kind: doc.kind,
    parentId: doc.parentId ? String(doc.parentId) : null,
    icon: doc.icon ?? null,
    color: doc.color ?? null,
    isEssential: doc.isEssential,
    isSystem: doc.isSystem,
    archived: Boolean(doc.archivedAt),
  };
}

/** Builds the 2-level tree, parents and children sorted by name (system categories last). */
export function buildCategoryTree(categories: readonly CategoryDTO[]): CategoryNode[] {
  const byName = (a: CategoryDTO, b: CategoryDTO) =>
    Number(a.isSystem) - Number(b.isSystem) || a.name.localeCompare(b.name);
  const roots = categories.filter((c) => !c.parentId).sort(byName);
  return roots.map((root) => ({
    ...root,
    children: categories.filter((c) => c.parentId === root.id).sort(byName),
  }));
}

/** Seeds system categories (idempotent upserts) and, once, the starter set. */
export async function seedCategories(userId: string, session: ClientSession): Promise<void> {
  const uid = toObjectId(userId, "User");
  await CategoryModel.bulkWrite(
    SYSTEM_CATEGORIES.map((c) => ({
      updateOne: {
        filter: { userId: uid, kind: c.kind, name: c.name, isSystem: true },
        update: { $setOnInsert: { userId: uid, kind: c.kind, name: c.name, isSystem: true } },
        upsert: true,
      },
    })),
    { session },
  );
  for (const c of STARTER_CATEGORIES) {
    const [parent] = await CategoryModel.create(
      [{ userId: uid, name: c.name, kind: c.kind, isEssential: c.isEssential ?? false }],
      { session },
    );
    if (c.children?.length) {
      await CategoryModel.create(
        c.children.map((child) => ({
          userId: uid,
          name: child.name,
          kind: c.kind,
          parentId: parent!._id,
          isEssential: child.isEssential ?? false,
        })),
        { session, ordered: true },
      );
    }
  }
}

export async function listCategories(
  ctx: Ctx,
  opts: { includeArchived?: boolean } = {},
): Promise<CategoryDTO[]> {
  await connectDb();
  const docs = await CategoryModel.find({
    userId: toObjectId(ctx.userId, "User"),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  }).lean<CategoryDoc[]>();
  return docs.map(toCategoryDTO);
}

export async function getCategoryTree(
  ctx: Ctx,
  opts: { includeArchived?: boolean } = {},
): Promise<CategoryNode[]> {
  return buildCategoryTree(await listCategories(ctx, opts));
}

async function loadOwned(ctx: Ctx, id: string, session?: ClientSession): Promise<CategoryDoc> {
  const doc = await CategoryModel.findOne({
    _id: toObjectId(id, "Category"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session ?? null)
    .lean<CategoryDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Category not found");
  return doc;
}

/** For the ledger: an active category of `kind` owned by the user. */
export async function assertUsableCategory(
  ctx: Ctx,
  id: string,
  kind: CategoryKind,
  session?: ClientSession,
): Promise<CategoryDoc> {
  const doc = await loadOwned(ctx, id, session);
  if (doc.archivedAt) throw new AppError("VALIDATION", `Category "${doc.name}" is archived`);
  if (doc.kind !== kind) {
    throw new AppError("VALIDATION", `"${doc.name}" is an ${doc.kind} category, not ${kind}`);
  }
  return doc;
}

/** The id of a system category (seeded on first login). */
export async function getSystemCategoryId(
  ctx: Ctx,
  name: string,
  kind: CategoryKind,
  session?: ClientSession,
): Promise<Types.ObjectId> {
  const doc = await CategoryModel.findOne({
    userId: toObjectId(ctx.userId, "User"),
    name,
    kind,
    isSystem: true,
  })
    .session(session ?? null)
    .lean<CategoryDoc>();
  if (!doc) throw new AppError("INTERNAL", `System category "${name}" is missing`);
  return doc._id;
}

/** Ids of a category and its children (for filters and budgets). */
export async function categoryWithChildrenIds(ctx: Ctx, id: string): Promise<Types.ObjectId[]> {
  const root = await loadOwned(ctx, id);
  const children = await CategoryModel.find({ userId: root.userId, parentId: root._id })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  return [root._id, ...children.map((c) => c._id)];
}

async function validateParent(
  ctx: Ctx,
  parentId: string | null,
  kind: CategoryKind,
  selfId: Types.ObjectId | null,
  session: ClientSession,
): Promise<Types.ObjectId | null> {
  if (!parentId) return null;
  const parent = await loadOwned(ctx, parentId, session);
  if (selfId && parent._id.equals(selfId)) {
    throw new AppError("VALIDATION", "A category cannot be its own parent", {
      parentId: ["Choose a different parent"],
    });
  }
  if (parent.parentId) {
    throw new AppError("VALIDATION", "Categories have two levels", {
      parentId: ["Choose a top-level category"],
    });
  }
  if (parent.kind !== kind) {
    throw new AppError("VALIDATION", "Parent must be the same kind", {
      parentId: [`Choose an ${kind} category`],
    });
  }
  if (parent.archivedAt) {
    throw new AppError("VALIDATION", "Parent is archived", { parentId: ["Parent is archived"] });
  }
  return parent._id;
}

async function assertUniqueName(
  ctx: Ctx,
  name: string,
  kind: CategoryKind,
  parentId: Types.ObjectId | null,
  exceptId: Types.ObjectId | null,
  session: ClientSession,
): Promise<void> {
  const clash = await CategoryModel.findOne({
    userId: toObjectId(ctx.userId, "User"),
    kind,
    parentId,
    archivedAt: null,
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .session(session)
    .lean();
  if (clash) {
    throw new AppError("CONFLICT", "A category with this name already exists here", {
      name: ["Name already used"],
    });
  }
}

export async function createCategory(ctx: Ctx, input: unknown): Promise<CategoryDTO> {
  const data = parseInput(createCategorySchema, input);
  return withTransaction(async (session) => {
    const parentId = await validateParent(ctx, data.parentId, data.kind, null, session);
    await assertUniqueName(ctx, data.name, data.kind, parentId, null, session);
    const [doc] = await CategoryModel.create(
      [{ ...data, parentId, userId: toObjectId(ctx.userId, "User") }],
      { session },
    );
    return toCategoryDTO(doc!.toObject());
  });
}

export async function updateCategory(ctx: Ctx, id: string, input: unknown): Promise<CategoryDTO> {
  const data = parseInput(updateCategorySchema, input);
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.isSystem && (data.name !== undefined || data.parentId !== undefined)) {
      throw new AppError("FORBIDDEN", "System categories cannot be renamed or moved");
    }
    const $set: Record<string, unknown> = { ...data };
    let parentId = current.parentId;
    if (data.parentId !== undefined) {
      if (data.parentId) {
        const hasChildren = await CategoryModel.exists({
          userId: current.userId,
          parentId: current._id,
          archivedAt: null,
        }).session(session);
        if (hasChildren) {
          throw new AppError("VALIDATION", "A category with subcategories must stay top-level", {
            parentId: ["Move its subcategories first"],
          });
        }
      }
      parentId = await validateParent(ctx, data.parentId, current.kind, current._id, session);
      $set.parentId = parentId;
    }
    if (data.name !== undefined || data.parentId !== undefined) {
      await assertUniqueName(
        ctx,
        data.name ?? current.name,
        current.kind,
        parentId,
        current._id,
        session,
      );
    }
    const doc = await CategoryModel.findOneAndUpdate(
      { _id: current._id, userId: current.userId },
      { $set },
      { returnDocument: "after", session, lean: true },
    );
    return toCategoryDTO(doc as CategoryDoc);
  });
}

/** Archives a category and its subcategories. Posted transactions keep their category. */
export async function archiveCategory(ctx: Ctx, id: string): Promise<CategoryDTO> {
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.isSystem) throw new AppError("FORBIDDEN", "System categories cannot be archived");
    const now = new Date();
    await CategoryModel.updateMany(
      {
        userId: current.userId,
        $or: [{ _id: current._id }, { parentId: current._id }],
        archivedAt: null,
      },
      { $set: { archivedAt: now } },
      { session },
    );
    return toCategoryDTO({ ...current, archivedAt: now });
  });
}

export async function unarchiveCategory(ctx: Ctx, id: string): Promise<CategoryDTO> {
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.parentId) {
      const parent = await loadOwned(ctx, String(current.parentId), session);
      if (parent.archivedAt) throw new AppError("VALIDATION", "Restore the parent category first");
    }
    await assertUniqueName(ctx, current.name, current.kind, current.parentId, current._id, session);
    const doc = await CategoryModel.findOneAndUpdate(
      { _id: current._id, userId: current.userId },
      { $set: { archivedAt: null } },
      { returnDocument: "after", session, lean: true },
    );
    return toCategoryDTO(doc as CategoryDoc);
  });
}
