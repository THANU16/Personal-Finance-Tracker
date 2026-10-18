import "server-only";
import { seedAssetClasses } from "@/modules/asset-classes/service";
import { seedCategories } from "@/modules/categories/service";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { claimBootstrap, getOrCreateSettings } from "@/modules/settings/service";
import { withTransaction } from "@/server/db/transaction";

/** Bump when a phase adds new per-user seed data. */
export const BOOTSTRAP_VERSION = 1;

/**
 * First-login setup: settings with defaults, then (once, atomically) system + starter categories
 * and asset classes. Concurrent first requests seed exactly once: the version claim on the settings
 * document conflicts, the loser's transaction retries and finds nothing to do.
 */
export async function ensureUserSetup(userId: string): Promise<SettingsDTO> {
  const settings = await getOrCreateSettings(userId);
  if (settings.bootstrapVersion >= BOOTSTRAP_VERSION) return settings;
  await withTransaction(async (session) => {
    if (!(await claimBootstrap(userId, BOOTSTRAP_VERSION, session))) return;
    await seedCategories(userId, session);
    await seedAssetClasses(userId, session);
  });
  return { ...settings, bootstrapVersion: BOOTSTRAP_VERSION };
}
