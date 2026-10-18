import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { AssetClassModel } from "@/modules/asset-classes/model";
import {
  archiveAssetClass,
  createAssetClass,
  listAssetClasses,
  updateAssetClass,
} from "@/modules/asset-classes/service";
import { CategoryModel } from "@/modules/categories/model";
import { STARTER_CATEGORIES, SYSTEM_CATEGORIES } from "@/modules/categories/seed";
import {
  archiveCategory,
  createCategory,
  getCategoryTree,
  unarchiveCategory,
  updateCategory,
} from "@/modules/categories/service";
import { ensureUserSetup } from "@/server/bootstrap";
import { AppError } from "@/server/errors";
import { categoryId, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const STARTER_COUNT = STARTER_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("first-login seeding", () => {
  it("seeds system + starter categories and the 7 asset classes", async () => {
    const ctx = await makeUser();
    const uid = new Types.ObjectId(ctx.userId);
    expect(await CategoryModel.countDocuments({ userId: uid, isSystem: true })).toBe(
      SYSTEM_CATEGORIES.length,
    );
    expect(await CategoryModel.countDocuments({ userId: uid, isSystem: false })).toBe(
      STARTER_COUNT,
    );
    expect((await listAssetClasses(ctx)).map((c) => c.name)).toEqual([
      "Equity",
      "Fixed Income",
      "Gold",
      "Crypto",
      "Real Estate",
      "Cash & Equivalents",
      "Other",
    ]);
  });

  it("seeds exactly once, even with concurrent first requests", async () => {
    const userId = new Types.ObjectId().toString();
    await Promise.all(Array.from({ length: 8 }, () => ensureUserSetup(userId)));
    await ensureUserSetup(userId);
    const uid = new Types.ObjectId(userId);
    expect(await CategoryModel.countDocuments({ userId: uid })).toBe(
      SYSTEM_CATEGORIES.length + STARTER_COUNT,
    );
    expect(await AssetClassModel.countDocuments({ userId: uid })).toBe(7);
  });

  it("does not re-create starter categories the user removed or renamed", async () => {
    const ctx = await makeUser();
    await updateCategory(ctx, await categoryId(ctx, "Shopping"), { name: "Clothes" });
    await ensureUserSetup(ctx.userId);
    const uid = new Types.ObjectId(ctx.userId);
    expect(await CategoryModel.countDocuments({ userId: uid, name: "Shopping" })).toBe(0);
  });
});

describe("categories", () => {
  it("builds a two-level tree with children under their parent", async () => {
    const ctx = await makeUser();
    const tree = await getCategoryTree(ctx);
    const food = tree.find((c) => c.name === "Food & Dining")!;
    expect(food.children.map((c) => c.name)).toEqual(["Groceries", "Restaurants"]);
    expect(food.children.find((c) => c.name === "Groceries")?.isEssential).toBe(true);
    expect(tree.filter((c) => c.parentId !== null)).toEqual([]);
  });

  it("creates subcategories under a same-kind top-level parent only", async () => {
    const ctx = await makeUser();
    const food = await categoryId(ctx, "Food & Dining");
    const sub = await createCategory(ctx, { name: "Snacks", kind: "expense", parentId: food });
    expect(sub.parentId).toBe(food);
    expect(
      (await errorOf(createCategory(ctx, { name: "Deep", kind: "expense", parentId: sub.id })))
        .fieldErrors,
    ).toHaveProperty("parentId");
    expect(
      (await errorOf(createCategory(ctx, { name: "Tips", kind: "income", parentId: food })))
        .fieldErrors,
    ).toHaveProperty("parentId");
    expect(
      (await errorOf(createCategory(ctx, { name: "groceries", kind: "expense", parentId: food })))
        .code,
    ).toBe("CONFLICT");
  });

  it("protects system categories", async () => {
    const ctx = await makeUser();
    const adj = await categoryId(ctx, "Balance adjustment");
    expect((await errorOf(updateCategory(ctx, adj, { name: "x" }))).code).toBe("FORBIDDEN");
    expect((await errorOf(archiveCategory(ctx, adj))).code).toBe("FORBIDDEN");
    expect((await updateCategory(ctx, adj, { color: "#ff0000" })).color).toBe("#ff0000");
  });

  it("archives a parent together with its children and restores them in order", async () => {
    const ctx = await makeUser();
    const housing = await categoryId(ctx, "Housing");
    const rent = await categoryId(ctx, "Rent");
    await archiveCategory(ctx, housing);
    const active = await getCategoryTree(ctx);
    expect(active.find((c) => c.name === "Housing")).toBeUndefined();
    expect((await errorOf(unarchiveCategory(ctx, rent))).code).toBe("VALIDATION");
    await unarchiveCategory(ctx, housing);
    expect((await unarchiveCategory(ctx, rent)).archived).toBe(false);
  });

  it("keeps a category with subcategories at the top level", async () => {
    const ctx = await makeUser();
    const err = await errorOf(
      updateCategory(ctx, await categoryId(ctx, "Housing"), {
        parentId: await categoryId(ctx, "Transport"),
      }),
    );
    expect(err.fieldErrors).toHaveProperty("parentId");
  });

  it("hides other users' categories", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const err = await errorOf(
      updateCategory(bob, await categoryId(alice, "Health"), { isEssential: false }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("asset classes", () => {
  it("creates, reorders and archives custom classes; protects system ones", async () => {
    const ctx = await makeUser();
    const pe = await createAssetClass(ctx, { name: "Private equity", color: "#111111" });
    expect(pe.sortOrder).toBe(70);
    expect((await updateAssetClass(ctx, pe.id, { sortOrder: 5 })).sortOrder).toBe(5);
    expect((await errorOf(createAssetClass(ctx, { name: "gold", color: "#222222" }))).code).toBe(
      "CONFLICT",
    );
    const equity = (await listAssetClasses(ctx)).find((c) => c.name === "Equity")!;
    expect((await errorOf(updateAssetClass(ctx, equity.id, { name: "Stocks" }))).code).toBe(
      "FORBIDDEN",
    );
    expect((await errorOf(archiveAssetClass(ctx, equity.id))).code).toBe("FORBIDDEN");
    expect((await updateAssetClass(ctx, equity.id, { color: "#000000" })).color).toBe("#000000");
    await archiveAssetClass(ctx, pe.id);
    expect((await listAssetClasses(ctx)).map((c) => c.name)).not.toContain("Private equity");
  });
});
