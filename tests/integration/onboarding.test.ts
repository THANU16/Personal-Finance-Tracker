import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { SettingsModel } from "@/modules/settings/model";
import { completeOnboarding, loadDemoData, needsOnboarding } from "@/modules/settings/onboarding";
import { ensureUserSetup } from "@/server/bootstrap";
import { makeAccount, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

describe("onboarding (docs/05 §18)", () => {
  it("a new user needs it until they finish or skip; then never again", async () => {
    const ctx = await makeUser();
    expect(await needsOnboarding(ctx)).toBe(true);
    await completeOnboarding(ctx);
    expect(await needsOnboarding(ctx)).toBe(false);
    const s = await SettingsModel.findOne({ userId: new Types.ObjectId(ctx.userId) }).lean();
    expect(s?.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("a user with accounts does not need it", async () => {
    const ctx = await makeUser();
    await makeAccount(ctx);
    expect(await needsOnboarding(ctx)).toBe(false);
  });

  it("bootstrap v6 marks existing users who already have accounts as onboarded", async () => {
    const withData = await makeUser();
    await makeAccount(withData);
    const empty = await makeUser();
    for (const c of [withData, empty]) {
      await SettingsModel.updateOne(
        { userId: new Types.ObjectId(c.userId) },
        { $set: { bootstrapVersion: 5, onboardingCompletedAt: null } },
      );
      await ensureUserSetup(c.userId);
    }
    const doc = async (id: string) =>
      SettingsModel.findOne({ userId: new Types.ObjectId(id) }).lean();
    expect((await doc(withData.userId))?.onboardingCompletedAt).toBeInstanceOf(Date);
    expect((await doc(empty.userId))?.onboardingCompletedAt ?? null).toBeNull();
  });

  it("demo data loads only into an empty account", async () => {
    const ctx = await makeUser();
    await makeAccount(ctx);
    await expect(loadDemoData(ctx)).rejects.toThrow(/only into an empty account/);
  });
});
