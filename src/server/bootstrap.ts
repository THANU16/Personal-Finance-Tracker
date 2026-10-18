import "server-only";
import { migrateAssetClassColors, seedAssetClasses } from "@/modules/asset-classes/service";
import { mergeDuplicateCategories } from "@/modules/categories/dedupe";
import { seedCategories } from "@/modules/categories/service";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { claimBootstrap, getOrCreateSettings } from "@/modules/settings/service";
import { withTransaction } from "@/server/db/transaction";
import { HoldingModel } from "@/modules/holdings/model";
import { recomputeHolding } from "@/server/ledger/recompute";
import { Types, type ClientSession } from "mongoose";

async function recomputeUserHoldings(
  userId: string,
  tz: string,
  session: ClientSession,
): Promise<void> {
  const holdings = await HoldingModel.find({ userId: new Types.ObjectId(userId) })
    .select({ _id: 1 })
    .session(session)
    .lean<{ _id: Types.ObjectId }[]>();
  for (const h of holdings) await recomputeHolding({ userId, tz }, h._id, session);
}

/** Bump when a phase adds new per-user seed data. */
export const BOOTSTRAP_VERSION = 5;

/**
 * First-login setup: settings with defaults, then (once, atomically) system + starter categories
 * and asset classes. Concurrent first requests seed exactly once: the version claim on the settings
 * document conflicts, the loser's transaction retries and finds nothing to do.
 */
export async function ensureUserSetup(userId: string): Promise<SettingsDTO> {
  const settings = await getOrCreateSettings(userId);
  if (settings.bootstrapVersion >= BOOTSTRAP_VERSION) return settings;
  const from = settings.bootstrapVersion;
  await withTransaction(async (session) => {
    if (!(await claimBootstrap(userId, BOOTSTRAP_VERSION, session))) return;
    if (from < 1) {
      await seedCategories(userId, session);
      await seedAssetClasses(userId, session);
    }
    // v3 (Phase 4): validated chart palette for untouched system class colours.
    if (from < 3) await migrateAssetClassColors(userId, session);
    // v2 → re-run as v4: merge categories duplicated by the earlier non-idempotent seed. Idempotent;
    // re-run because accounts that reached v2 through an interim build skipped it.
    if (from < 4) await mergeDuplicateCategories(userId, session);
    // v5: redemptions moved to the cost-recovery method; replay every holding so stored
    // redemption figures (cost removed, realised gain) and caches follow it. Idempotent.
    if (from >= 1 && from < 5) await recomputeUserHoldings(userId, settings.timezone, session);
  });
  return { ...settings, bootstrapVersion: BOOTSTRAP_VERSION };
}
