import "server-only";
import type { ClientSession } from "mongoose";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import {
  createAssetClassSchema,
  updateAssetClassSchema,
  type AssetClassDTO,
} from "@/modules/asset-classes/schemas";
import { SYSTEM_ASSET_CLASSES } from "@/modules/asset-classes/seed";
import { countActiveHoldingsInClass } from "@/modules/holdings/service";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";

function toDTO(doc: AssetClassDoc): AssetClassDTO {
  return {
    id: String(doc._id),
    name: doc.name,
    color: doc.color,
    sortOrder: doc.sortOrder,
    isSystem: doc.isSystem,
    archived: Boolean(doc.archivedAt),
  };
}

/** Seeds the docs/03 asset classes (idempotent upserts). */
export async function seedAssetClasses(userId: string, session: ClientSession): Promise<void> {
  const uid = toObjectId(userId, "User");
  await AssetClassModel.bulkWrite(
    SYSTEM_ASSET_CLASSES.map((c, i) => ({
      updateOne: {
        filter: { userId: uid, name: c.name, isSystem: true },
        update: {
          $setOnInsert: {
            userId: uid,
            name: c.name,
            color: c.color,
            sortOrder: i * 10,
            isSystem: true,
          },
        },
        upsert: true,
      },
    })),
    { session },
  );
}

export async function listAssetClasses(
  ctx: Ctx,
  opts: { includeArchived?: boolean } = {},
): Promise<AssetClassDTO[]> {
  await connectDb();
  const docs = await AssetClassModel.find({
    userId: toObjectId(ctx.userId, "User"),
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  })
    .sort({ sortOrder: 1, name: 1 })
    .lean<AssetClassDoc[]>();
  return docs.map(toDTO);
}

async function loadOwned(ctx: Ctx, id: string, session: ClientSession): Promise<AssetClassDoc> {
  const doc = await AssetClassModel.findOne({
    _id: toObjectId(id, "Asset class"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<AssetClassDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Asset class not found");
  return doc;
}

async function assertUniqueName(
  ctx: Ctx,
  name: string,
  exceptId: AssetClassDoc["_id"] | null,
  session: ClientSession,
) {
  const clash = await AssetClassModel.findOne({
    userId: toObjectId(ctx.userId, "User"),
    archivedAt: null,
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .session(session)
    .lean();
  if (clash) {
    throw new AppError("CONFLICT", "An asset class with this name already exists", {
      name: ["Name already used"],
    });
  }
}

export async function createAssetClass(ctx: Ctx, input: unknown): Promise<AssetClassDTO> {
  const data = parseInput(createAssetClassSchema, input);
  return withTransaction(async (session) => {
    await assertUniqueName(ctx, data.name, null, session);
    const uid = toObjectId(ctx.userId, "User");
    const last = await AssetClassModel.findOne({ userId: uid })
      .sort({ sortOrder: -1 })
      .session(session)
      .lean<AssetClassDoc>();
    const [doc] = await AssetClassModel.create(
      [{ ...data, sortOrder: data.sortOrder ?? (last ? last.sortOrder + 10 : 0), userId: uid }],
      { session },
    );
    return toDTO(doc!.toObject());
  });
}

export async function updateAssetClass(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<AssetClassDTO> {
  const data = parseInput(updateAssetClassSchema, input);
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.isSystem && data.name !== undefined && data.name !== current.name) {
      throw new AppError("FORBIDDEN", "System asset classes cannot be renamed");
    }
    if (data.name !== undefined) await assertUniqueName(ctx, data.name, current._id, session);
    const doc = await AssetClassModel.findOneAndUpdate(
      { _id: current._id, userId: current.userId },
      { $set: data },
      { returnDocument: "after", session, lean: true },
    );
    return toDTO(doc as AssetClassDoc);
  });
}

/** Archives a custom asset class; refused while active holdings use it. */
export async function archiveAssetClass(ctx: Ctx, id: string): Promise<AssetClassDTO> {
  return withTransaction(async (session) => {
    const current = await loadOwned(ctx, id, session);
    if (current.isSystem)
      throw new AppError("FORBIDDEN", "System asset classes cannot be archived");
    const inUse = await countActiveHoldingsInClass(ctx, current._id, session);
    if (inUse > 0) {
      throw new AppError(
        "CONFLICT",
        `${inUse} active holding${inUse === 1 ? " uses" : "s use"} "${current.name}". Move or close them first.`,
      );
    }
    const doc = await AssetClassModel.findOneAndUpdate(
      { _id: current._id, userId: current.userId },
      { $set: { archivedAt: new Date() } },
      { returnDocument: "after", session, lean: true },
    );
    return toDTO(doc as AssetClassDoc);
  });
}
