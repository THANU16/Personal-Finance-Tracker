import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { SettingsModel } from "@/modules/settings/model";
import {
  getOrCreateSettings,
  getSettings,
  setHideAmounts,
  updateSettings,
} from "@/modules/settings/service";
import { AppError } from "@/server/errors";
import { makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

describe("getOrCreateSettings", () => {
  it("creates settings with the documented defaults on first use", async () => {
    const userId = new Types.ObjectId().toString();
    const s = await getOrCreateSettings(userId);
    expect(s).toEqual({
      baseCurrency: "LKR",
      timezone: "Asia/Colombo",
      locale: "en-LK",
      staleDays: 30,
      bigChangeThresholdBp: 2000,
      driftThresholdBp: 500,
      emergencyMonths: 6,
      emergencyExpenseBasis: "essential",
      emergencyManualMonthlyMinor: null,
      emergencyTargetOverrideMinor: null,
      lifeCoverIncomeMultiple: 10,
      healthCoverTargetMinor: null,
      minBalanceWarningMinor: 0,
      projectionReturnBp: 800,
      hideAmounts: false,
      notify: { email: false, inApp: true, dailyHourLocal: 6 },
      onboardingCompletedAt: null,
      bootstrapVersion: 0,
    });
  });

  it("is idempotent, including concurrent first requests", async () => {
    const userId = new Types.ObjectId().toString();
    await Promise.all(Array.from({ length: 10 }, () => getOrCreateSettings(userId)));
    await getOrCreateSettings(userId);
    expect(await SettingsModel.countDocuments({ userId })).toBe(1);
  });

  it("rejects a malformed user id", async () => {
    await expect(getOrCreateSettings("not-an-id")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("updateSettings", () => {
  it("updates only the given fields, including nested notify fields", async () => {
    const ctx = await makeUser();
    const s = await updateSettings(ctx, {
      timezone: "Asia/Kolkata",
      staleDays: 45,
      healthCoverTargetMinor: 150_000_000,
      notify: { email: true, inApp: true, dailyHourLocal: 7 },
    });
    expect(s.timezone).toBe("Asia/Kolkata");
    expect(s.staleDays).toBe(45);
    expect(s.healthCoverTargetMinor).toBe(150_000_000);
    expect(s.notify).toEqual({ email: true, inApp: true, dailyHourLocal: 7 });
    expect(s.baseCurrency).toBe("LKR");
    expect(s.driftThresholdBp).toBe(500);
  });

  it("returns current settings for an empty update", async () => {
    const ctx = await makeUser();
    expect((await updateSettings(ctx, {})).staleDays).toBe(30);
  });

  it.each([
    ["unknown timezone", { timezone: "Mars/Base" }, "timezone"],
    ["lowercase currency", { baseCurrency: "lkr" }, "baseCurrency"],
    ["fractional money", { minBalanceWarningMinor: 10.5 }, "minBalanceWarningMinor"],
    ["negative money", { minBalanceWarningMinor: -1 }, "minBalanceWarningMinor"],
    ["bp out of range", { bigChangeThresholdBp: 20_000 }, "bigChangeThresholdBp"],
    [
      "hour out of range",
      { notify: { email: false, inApp: true, dailyHourLocal: 24 } },
      "notify.dailyHourLocal",
    ],
    ["unknown field", { userId: new Types.ObjectId().toString() }, "_form"],
  ])("rejects %s with field errors", async (_label, input, field) => {
    const ctx = await makeUser();
    const err = await updateSettings(ctx, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("VALIDATION");
    expect(Object.keys((err as AppError).fieldErrors ?? {})).toContain(field);
    expect((await getSettings(ctx)).staleDays).toBe(30); // nothing persisted
  });

  it("never touches another user's settings", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await updateSettings(alice, { staleDays: 99 });
    expect((await getSettings(bob)).staleDays).toBe(30);
    expect((await getSettings(alice)).staleDays).toBe(99);
  });
});

describe("setHideAmounts", () => {
  it("toggles the flag for the current user only", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    expect((await setHideAmounts(alice, { hideAmounts: true })).hideAmounts).toBe(true);
    expect((await getSettings(bob)).hideAmounts).toBe(false);
    expect((await setHideAmounts(alice, { hideAmounts: false })).hideAmounts).toBe(false);
  });

  it("validates input", async () => {
    const ctx = await makeUser();
    await expect(setHideAmounts(ctx, { hideAmounts: "yes" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("emergency fund settings", () => {
  it("saves basis, manual amount and override", async () => {
    const ctx = await makeUser();
    const s = await updateSettings(ctx, {
      emergencyExpenseBasis: "manual",
      emergencyManualMonthlyMinor: 120_000_00,
      emergencyTargetOverrideMinor: 1_000_000_00,
    });
    expect(s).toMatchObject({
      emergencyExpenseBasis: "manual",
      emergencyManualMonthlyMinor: 120_000_00,
      emergencyTargetOverrideMinor: 1_000_000_00,
    });
    const cleared = await updateSettings(ctx, {
      emergencyExpenseBasis: "all",
      emergencyTargetOverrideMinor: null,
    });
    expect(cleared.emergencyTargetOverrideMinor).toBeNull();
    expect(cleared.emergencyManualMonthlyMinor).toBe(120_000_00); // kept for later
  });

  it("rejects a manual basis without an amount, including on the merged result", async () => {
    const ctx = await makeUser();
    await expect(updateSettings(ctx, { emergencyExpenseBasis: "manual" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { emergencyManualMonthlyMinor: expect.any(Array) },
    });
    await updateSettings(ctx, { emergencyExpenseBasis: "manual", emergencyManualMonthlyMinor: 5 });
    await expect(updateSettings(ctx, { emergencyManualMonthlyMinor: null })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects zero, negative, fractional amounts and unknown bases", async () => {
    const ctx = await makeUser();
    for (const input of [
      { emergencyManualMonthlyMinor: 0 },
      { emergencyTargetOverrideMinor: -1 },
      { emergencyTargetOverrideMinor: 1.5 },
      { emergencyExpenseBasis: "income" },
    ]) {
      await expect(updateSettings(ctx, input)).rejects.toBeInstanceOf(AppError);
    }
  });
});
