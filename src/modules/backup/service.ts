import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  checkEnvelope,
  remapIds,
  type BackupEnvelope,
} from "@/domain/backup";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import { writeAudit } from "@/server/audit/model";

// JSON backup / restore (Phase 11). Every user-scoped collection is exported as relaxed EJSON (ObjectIds and
// dates survive). Restore only into an EMPTY account (no accounts, holdings or transactions): the
// account's seeded categories, asset classes and settings are replaced by the backup's, every id is
// re-issued (references follow) so a backup can be restored next to the account it came from, and
// all caches are recomputed. Attachment files are not in the backup (metadata only).

/** Every collection that holds a user's data (auth collections are not part of a backup). */
export const BACKUP_COLLECTIONS = [
  "settings",
  "accounts",
  "earmarks",
  "categories",
  "categoryRules",
  "assetClasses",
  "holdings",
  "valuations",
  "transactions",
  "attachments",
  "sipPlans",
  "sipPlanVersions",
  "sipExecutions",
  "targetAllocations",
  "targetAllocationHistory",
  "opportunityFunds",
  "marketLevels",
  "opportunityDeployments",
  "debts",
  "recurringRules",
  "budgets",
  "goals",
  "insurancePolicies",
  "snapshots",
  "notifications",
  "monthlyReviews",
  "fxRates",
  "importBatches",
  "importRows",
  "importMappings",
  "auditLog",
] as const;

const { BSON } = mongoose.mongo;
type ObjectId = InstanceType<typeof BSON.ObjectId>;

function db() {
  const d = mongoose.connection.db;
  if (!d) throw new AppError("INTERNAL", "Database is not connected");
  return d;
}

/** The backup file (EJSON text) of the signed-in user. */
export async function exportBackup(ctx: Ctx): Promise<{ fileName: string; json: string }> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const collections: Record<string, Record<string, unknown>[]> = {};
  for (const name of BACKUP_COLLECTIONS) {
    collections[name] = await db().collection(name).find({ userId }).toArray();
  }
  const exportedAt = new Date();
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    baseCurrency: ctx.baseCurrency,
    collections,
  };
  return {
    fileName: `wealthtrack-backup-${exportedAt.toISOString().slice(0, 10)}.json`,
    json: BSON.EJSON.stringify(envelope, { relaxed: true }),
  };
}

/** True when the user has no accounts, holdings or transactions (restore is allowed). */
export async function isAccountEmpty(ctx: Ctx, session?: ClientSession): Promise<boolean> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  for (const name of ["accounts", "holdings", "transactions"]) {
    if (
      await db()
        .collection(name)
        .findOne({ userId }, { session, projection: { _id: 1 } })
    )
      return false;
  }
  return true;
}

/** Deletes every backed-up collection of the user (restore uses it on an empty account; tests too). */
export async function wipeUserData(userId: string, session?: ClientSession): Promise<void> {
  const id = toObjectId(userId, "User");
  for (const name of BACKUP_COLLECTIONS) {
    await db().collection(name).deleteMany({ userId: id }, { session });
  }
}

export interface RestoreResult {
  documents: number;
  collections: Record<string, number>;
  exportedAt: string;
}

/** Restores a backup into the signed-in (empty) account. One DB transaction; caches recomputed. */
export async function restoreBackup(ctx: Ctx, text: string): Promise<RestoreResult> {
  await connectDb();
  let parsed: unknown;
  try {
    parsed = BSON.EJSON.parse(text, { relaxed: true });
  } catch {
    throw new AppError("VALIDATION", "The file is not valid JSON");
  }
  const check = checkEnvelope(parsed, BACKUP_COLLECTIONS);
  if (!check.ok) throw new AppError("VALIDATION", check.message);
  const source = check.envelope.collections;
  for (const [name, docs] of Object.entries(source)) {
    if (
      docs.some((d) => typeof d !== "object" || d === null || !(d._id instanceof BSON.ObjectId))
    ) {
      throw new AppError("VALIDATION", `Collection "${name}" has an invalid document`);
    }
  }
  if ((source.settings?.length ?? 0) > 1)
    throw new AppError("VALIDATION", "The backup has more than one settings document");
  const target = toObjectId(ctx.userId, "User");
  const remapped = remapIds<ObjectId>(source, target as unknown as ObjectId, {
    isId: (v): v is ObjectId => v instanceof BSON.ObjectId,
    keyOf: (id) => id.toHexString(),
    fresh: () => new BSON.ObjectId(),
  });

  const counts: Record<string, number> = {};
  await withTransaction(async (session) => {
    if (!(await isAccountEmpty(ctx, session))) {
      throw new AppError(
        "CONFLICT",
        "Restore works only into an empty account (no accounts, holdings or transactions). Register a new account or remove your data first.",
      );
    }
    await wipeUserData(ctx.userId, session);
    for (const name of BACKUP_COLLECTIONS) {
      const docs = remapped[name] ?? [];
      counts[name] = docs.length;
      if (docs.length) await db().collection(name).insertMany(docs, { session, ordered: true });
    }
    if (!counts.settings) {
      throw new AppError("VALIDATION", "The backup has no settings document");
    }
    await writeAudit(
      {
        userId: ctx.userId,
        action: "restore_backup",
        entity: "backup",
        entityId: target,
        after: { exportedAt: check.envelope.exportedAt, counts },
      },
      session,
    );
  });
  const settings = remapped.settings![0]! as { timezone?: string };
  await recomputeAllForUser({ userId: ctx.userId, tz: settings.timezone ?? ctx.tz });
  return {
    documents: Object.values(counts).reduce((s, n) => s + n, 0),
    collections: counts,
    exportedAt: check.envelope.exportedAt,
  };
}
