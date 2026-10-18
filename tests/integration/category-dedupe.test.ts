import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { mergeDuplicateCategories } from "@/modules/categories/dedupe";
import { seedCategories } from "@/modules/categories/service";
import { STARTER_CATEGORIES, SYSTEM_CATEGORIES } from "@/modules/categories/seed";
import { SettingsModel } from "@/modules/settings/model";
import { TransactionModel } from "@/modules/transactions/model";
import { BOOTSTRAP_VERSION, ensureUserSetup } from "@/server/bootstrap";
import { withTransaction } from "@/server/db/transaction";
import { makeAccount, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const starterCount = STARTER_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);
const total = starterCount + SYSTEM_CATEGORIES.length;

const count = (userId: string) =>
  CategoryModel.countDocuments({ userId: new Types.ObjectId(userId) });

/** Inserts a raw copy of every starter category (what the old, non-idempotent seed did twice). */
async function legacyDuplicateSeed(userId: string) {
  const uid = new Types.ObjectId(userId);
  for (const c of STARTER_CATEGORIES) {
    const [parent] = await CategoryModel.create([{ userId: uid, name: c.name, kind: c.kind }]);
    for (const child of c.children ?? []) {
      await CategoryModel.create([
        { userId: uid, name: child.name, kind: c.kind, parentId: parent!._id },
      ]);
    }
  }
}

const find = (userId: string, name: string) =>
  CategoryModel.find({ userId: new Types.ObjectId(userId), name }).lean<CategoryDoc[]>();

describe("starter category seeding", () => {
  it("running setup twice never duplicates categories", async () => {
    const ctx = await makeUser();
    expect(await count(ctx.userId)).toBe(total);
    await withTransaction((session) => seedCategories(ctx.userId, session));
    expect(await count(ctx.userId)).toBe(total);
  });
});

describe("mergeDuplicateCategories (bootstrap v2)", () => {
  it("merges duplicates into the oldest copy and moves transactions, splits and children", async () => {
    const ctx = await makeUser();
    const account = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    await legacyDuplicateSeed(ctx.userId);
    expect(await count(ctx.userId)).toBe(total + starterCount);

    const [keepGroceries, dupGroceries] = (await find(ctx.userId, "Groceries")).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const [, dupRestaurants] = (await find(ctx.userId, "Restaurants")).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    // a transaction on the duplicate, and a split using both copies of Groceries
    const single = await post(ctx, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 1_000,
      fromAccountId: account.id,
      categoryId: String(dupGroceries!._id),
    });
    const split = await post(ctx, {
      type: "expense",
      date: "2026-02-02",
      amountMinor: 3_000,
      fromAccountId: account.id,
      splits: [
        { categoryId: String(keepGroceries!._id), amountMinor: 1_000 },
        { categoryId: String(dupGroceries!._id), amountMinor: 1_500 },
        { categoryId: String(dupRestaurants!._id), amountMinor: 500 },
      ],
    });

    const merged = await withTransaction((session) =>
      mergeDuplicateCategories(ctx.userId, session),
    );
    expect(merged).toBe(starterCount);
    expect(await count(ctx.userId)).toBe(total);

    const uid = new Types.ObjectId(ctx.userId);
    const t1 = await TransactionModel.findOne({ _id: single, userId: uid }).lean();
    expect(String(t1!.categoryId)).toBe(String(keepGroceries!._id));
    const t2 = await TransactionModel.findOne({ _id: split, userId: uid }).lean();
    expect(t2!.splits.map((l) => l.amountMinor).sort((a, b) => a - b)).toEqual([500, 2_500]);
    expect(t2!.splits.reduce((s, l) => s + l.amountMinor, 0)).toBe(3_000);
    // every child now hangs under a surviving parent
    const ids = new Set(
      (await CategoryModel.find({ userId: uid }).lean()).map((c) => String(c._id)),
    );
    for (const c of await CategoryModel.find({ userId: uid, parentId: { $ne: null } }).lean()) {
      expect(ids.has(String(c.parentId))).toBe(true);
    }
  });

  it("an existing v1 user is repaired once on the next request", async () => {
    const ctx = await makeUser();
    await legacyDuplicateSeed(ctx.userId);
    await SettingsModel.updateOne(
      { userId: new Types.ObjectId(ctx.userId) },
      { $set: { bootstrapVersion: 1 } },
    );
    await ensureUserSetup(ctx.userId);
    expect(await count(ctx.userId)).toBe(total);
    await ensureUserSetup(ctx.userId);
    expect(await count(ctx.userId)).toBe(total);
  });

  it("repairs an account that reached v2 without the merge, system duplicates included", async () => {
    const ctx = await makeUser();
    const uid = new Types.ObjectId(ctx.userId);
    await legacyDuplicateSeed(ctx.userId);
    // A system duplicate can exist on databases where the unique index was built after it.
    await CategoryModel.collection.dropIndex("uniq_system_category");
    try {
      const [bankFees] = await CategoryModel.find({ userId: uid, name: "Bank fees" }).lean();
      await CategoryModel.collection.insertOne({
        userId: uid,
        name: "Bank fees",
        kind: "expense",
        parentId: null,
        isSystem: true,
        isEssential: false,
        archivedAt: null,
        createdAt: new Date(bankFees!.createdAt.getTime() + 1_000),
        updatedAt: new Date(),
      });
      await SettingsModel.updateOne({ userId: uid }, { $set: { bootstrapVersion: 2 } });
      await ensureUserSetup(ctx.userId);
      expect(await count(ctx.userId)).toBe(total);
      expect(await CategoryModel.countDocuments({ userId: uid, name: "Bank fees" })).toBe(1);
    } finally {
      await CategoryModel.syncIndexes(); // restore the unique index for the other tests
    }
  });

  it("settings created before Phase 2 (no bootstrapVersion field) are set up once and repaired", async () => {
    const ctx = await makeUser();
    const uid = new Types.ObjectId(ctx.userId);
    await legacyDuplicateSeed(ctx.userId);
    await legacyDuplicateSeed(ctx.userId);
    await SettingsModel.collection.updateOne({ userId: uid }, { $unset: { bootstrapVersion: "" } });
    await ensureUserSetup(ctx.userId);
    expect(await count(ctx.userId)).toBe(total);
    const raw = await SettingsModel.collection.findOne({ userId: uid });
    expect(raw?.bootstrapVersion).toBe(BOOTSTRAP_VERSION);
    await ensureUserSetup(ctx.userId); // nothing more happens
    expect(await count(ctx.userId)).toBe(total);
  });

  it("leaves other users alone", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await legacyDuplicateSeed(b.userId);
    await withTransaction((session) => mergeDuplicateCategories(a.userId, session));
    expect(await count(b.userId)).toBe(total + starterCount);
  });
});

describe("asset class palette (bootstrap v3)", () => {
  it("moves untouched system class colours to the validated palette and keeps custom ones", async () => {
    const { AssetClassModel } = await import("@/modules/asset-classes/model");
    const ctx = await makeUser();
    const uid = new Types.ObjectId(ctx.userId);
    await AssetClassModel.updateOne(
      { userId: uid, name: "Equity" },
      { $set: { color: "#2563eb" } },
    );
    await AssetClassModel.updateOne({ userId: uid, name: "Gold" }, { $set: { color: "#123456" } });
    await SettingsModel.updateOne({ userId: uid }, { $set: { bootstrapVersion: 2 } });
    await ensureUserSetup(ctx.userId);
    const byName = new Map(
      (await AssetClassModel.find({ userId: uid }).lean()).map((c) => [c.name, c.color]),
    );
    expect(byName.get("Equity")).toBe("#2a78d6");
    expect(byName.get("Gold")).toBe("#123456");
  });
});
