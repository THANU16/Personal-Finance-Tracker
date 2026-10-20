import "server-only";
import { utcToBusinessDate } from "@/domain/dates";
import { AccountModel } from "@/modules/accounts/model";
import { SettingsModel } from "@/modules/settings/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";

// docs/05 §18 — first-login onboarding: preferences → accounts → holdings → (optional) SIP → done.
// Skippable; "Load demo data" only outside production.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");

/** True for a new user: onboarding not finished and no accounts yet. */
export async function needsOnboarding(ctx: Ctx): Promise<boolean> {
  await connectDb();
  const s = await SettingsModel.findOne({ userId: uid(ctx) })
    .select({ onboardingCompletedAt: 1 })
    .lean<{ onboardingCompletedAt: Date | null }>();
  if (s?.onboardingCompletedAt) return false;
  return !(await AccountModel.exists({ userId: uid(ctx) }));
}

/** Done or skipped: never shown again. */
export async function completeOnboarding(ctx: Ctx): Promise<{ done: true }> {
  await connectDb();
  await SettingsModel.updateOne(
    { userId: uid(ctx), onboardingCompletedAt: null },
    { $set: { onboardingCompletedAt: new Date() } },
  );
  return { done: true };
}

export const demoDataAllowed = () => getEnv().NODE_ENV !== "production";

/** Development only: fills an EMPTY account with the 18-month demo data, then finishes onboarding. */
export async function loadDemoData(ctx: Ctx): Promise<{ transactions: number }> {
  if (!demoDataAllowed()) throw new AppError("FORBIDDEN", "Demo data is not available here");
  await connectDb();
  if (await AccountModel.exists({ userId: uid(ctx) })) {
    throw new AppError("CONFLICT", "Demo data loads only into an empty account");
  }
  const { seedDemoData } = await import("@/server/seed/demo");
  const summary = await seedDemoData(ctx, utcToBusinessDate(new Date(), ctx.tz));
  await completeOnboarding(ctx);
  return { transactions: summary.transactions };
}
