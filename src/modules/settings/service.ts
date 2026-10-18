import "server-only";
import { Types, type ClientSession } from "mongoose";
import { SettingsModel, type SettingsDoc } from "@/modules/settings/model";
import {
  setHideAmountsSchema,
  updateSettingsSchema,
  type SettingsDTO,
} from "@/modules/settings/schemas";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";

function toDTO(doc: SettingsDoc): SettingsDTO {
  return {
    baseCurrency: doc.baseCurrency,
    timezone: doc.timezone,
    locale: doc.locale,
    staleDays: doc.staleDays,
    bigChangeThresholdBp: doc.bigChangeThresholdBp,
    driftThresholdBp: doc.driftThresholdBp,
    emergencyMonths: doc.emergencyMonths,
    emergencyExpenseBasis: doc.emergencyExpenseBasis ?? "essential",
    emergencyManualMonthlyMinor: doc.emergencyManualMonthlyMinor ?? null,
    emergencyTargetOverrideMinor: doc.emergencyTargetOverrideMinor ?? null,
    lifeCoverIncomeMultiple: doc.lifeCoverIncomeMultiple,
    healthCoverTargetMinor: doc.healthCoverTargetMinor ?? null,
    minBalanceWarningMinor: doc.minBalanceWarningMinor,
    hideAmounts: doc.hideAmounts,
    notify: {
      email: doc.notify?.email ?? false,
      inApp: doc.notify?.inApp ?? true,
      dailyHourLocal: doc.notify?.dailyHourLocal ?? 6,
    },
    onboardingCompletedAt: doc.onboardingCompletedAt
      ? doc.onboardingCompletedAt.toISOString()
      : null,
    bootstrapVersion: doc.bootstrapVersion ?? 0,
  };
}

function toObjectId(userId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(userId)) throw new AppError("UNAUTHORIZED", "Invalid user");
  return new Types.ObjectId(userId);
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * Returns the user's settings, creating them with defaults on first use (first login).
 * Atomic upsert, so concurrent first requests produce exactly one document.
 */
export async function getOrCreateSettings(userId: string): Promise<SettingsDTO> {
  await connectDb();
  const env = getEnv();
  const filter = { userId: toObjectId(userId) };
  const upsert = () =>
    SettingsModel.findOneAndUpdate(
      filter,
      { $setOnInsert: { baseCurrency: env.DEFAULT_CURRENCY, timezone: env.DEFAULT_TIMEZONE } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, lean: true },
    );
  let doc: SettingsDoc | null;
  try {
    doc = await upsert();
  } catch (err) {
    // A concurrent upsert won the unique-index race; the document now exists.
    if (!isDuplicateKeyError(err)) throw err;
    doc = await SettingsModel.findOne(filter).lean<SettingsDoc>();
  }
  if (!doc) throw new AppError("INTERNAL", "Could not load settings");
  return toDTO(doc as SettingsDoc);
}

export async function getSettings(ctx: Ctx): Promise<SettingsDTO> {
  return getOrCreateSettings(ctx.userId);
}

async function applySet(ctx: Ctx, $set: Record<string, unknown>): Promise<SettingsDTO> {
  const current = await getOrCreateSettings(ctx.userId);
  if (Object.keys($set).length === 0) return current;
  const doc = await SettingsModel.findOneAndUpdate(
    { userId: toObjectId(ctx.userId) },
    { $set },
    { returnDocument: "after", runValidators: true, lean: true },
  );
  if (!doc) throw new AppError("NOT_FOUND", "Settings not found");
  return toDTO(doc as SettingsDoc);
}

export async function updateSettings(ctx: Ctx, input: unknown): Promise<SettingsDTO> {
  const { notify, ...rest } = parseInput(updateSettingsSchema, input);
  const $set: Record<string, unknown> = { ...rest };
  if (notify) {
    for (const [k, v] of Object.entries(notify)) $set[`notify.${k}`] = v;
  }
  // Cross-field rule on the merged result (updates are partial): a manual basis needs an amount.
  if (rest.emergencyExpenseBasis !== undefined || rest.emergencyManualMonthlyMinor !== undefined) {
    const current = await getOrCreateSettings(ctx.userId);
    const basis = rest.emergencyExpenseBasis ?? current.emergencyExpenseBasis;
    const manual =
      rest.emergencyManualMonthlyMinor !== undefined
        ? rest.emergencyManualMonthlyMinor
        : current.emergencyManualMonthlyMinor;
    if (basis === "manual" && manual === null) {
      throw new AppError("VALIDATION", "Enter the monthly amount for a manual basis", {
        emergencyManualMonthlyMinor: ["Enter a monthly amount"],
      });
    }
  }
  return applySet(ctx, $set);
}

export async function setHideAmounts(ctx: Ctx, input: unknown): Promise<SettingsDTO> {
  const { hideAmounts } = parseInput(setHideAmountsSchema, input);
  return applySet(ctx, { hideAmounts });
}

/**
 * Atomically claims one-time setup up to `version` (inside the caller's transaction). Returns
 * false when another request already claimed it, so seeding runs exactly once per user.
 */
export async function claimBootstrap(
  userId: string,
  version: number,
  session: ClientSession,
): Promise<boolean> {
  const res = await SettingsModel.updateOne(
    { userId: toObjectId(userId), bootstrapVersion: { $lt: version } },
    { $set: { bootstrapVersion: version } },
    { session },
  );
  return res.modifiedCount === 1;
}
