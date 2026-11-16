import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { CategoryModel } from "@/modules/categories/model";
import { copyLastMonth, getBudgetMonth, removeBudget, setBudget } from "@/modules/budgets/service";
import type { AppError } from "@/server/errors";
import type { Ctx } from "@/server/ctx";
import { categoryId, makeAccount, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Repeating budgets (owner request, docs/04 §13): set once, apply every month.

setupTestDb();

async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { openingBalanceMinor: 10_000_000 });
  const food = await categoryId(ctx, "Groceries");
  const [fuelDoc] = await CategoryModel.create([
    { userId: new Types.ObjectId(ctx.userId), name: "Fuel test", kind: "expense" },
  ]);
  return { ctx, bank, food, fuel: String(fuelDoc!._id) };
}

const budgetOf = async (ctx: Ctx, month: string, id: string) =>
  (await getBudgetMonth(ctx, month)).rows.find((r) => r.categoryId === id);

describe("repeating budgets", () => {
  it("set once: applies in later months (alerts included), not in earlier ones", async () => {
    const { ctx, bank, food } = await setup();
    await setBudget(ctx, {
      month: "2026-03",
      categoryId: food,
      amountMinor: 50_000,
      applies: "repeat",
    });
    expect(await budgetOf(ctx, "2026-02", food)).toBeUndefined();
    expect(await budgetOf(ctx, "2026-03", food)).toMatchObject({
      budgetMinor: 50_000,
      repeat: { fromMonth: "2026-03", untilMonth: null },
    });
    await post(ctx, {
      type: "expense",
      date: "2027-01-10",
      amountMinor: 45_000,
      fromAccountId: bank.id,
      categoryId: food,
    });
    expect(await budgetOf(ctx, "2027-01", food)).toMatchObject({
      budgetMinor: 50_000,
      spentMinor: 45_000,
      status: "warn",
    });
    expect((await getBudgetMonth(ctx, "2027-02")).previousMonthBudgets).toBe(1);
  });

  it("changing the amount from a later month keeps earlier months", async () => {
    const { ctx, food } = await setup();
    await setBudget(ctx, {
      month: "2026-01",
      categoryId: food,
      amountMinor: 50_000,
      applies: "repeat",
    });
    await setBudget(ctx, {
      month: "2026-06",
      categoryId: food,
      amountMinor: 60_000,
      applies: "repeat",
    });
    expect((await budgetOf(ctx, "2026-05", food))?.budgetMinor).toBe(50_000);
    expect((await budgetOf(ctx, "2026-06", food))?.budgetMinor).toBe(60_000);
    expect((await budgetOf(ctx, "2028-06", food))?.budgetMinor).toBe(60_000);
    // Setting "from now on" earlier again replaces the later change.
    await setBudget(ctx, {
      month: "2026-03",
      categoryId: food,
      amountMinor: 55_000,
      applies: "repeat",
    });
    expect((await budgetOf(ctx, "2026-08", food))?.budgetMinor).toBe(55_000);
    expect((await budgetOf(ctx, "2026-02", food))?.budgetMinor).toBe(50_000);
  });

  it("until a month: stops after it; an older open-ended budget applies again", async () => {
    const { ctx, food, fuel } = await setup();
    await setBudget(ctx, {
      month: "2026-01",
      categoryId: fuel,
      amountMinor: 20_000,
      applies: "repeat",
      untilMonth: "2026-06",
    });
    expect((await budgetOf(ctx, "2026-06", fuel))?.repeat).toEqual({
      fromMonth: "2026-01",
      untilMonth: "2026-06",
    });
    expect(await budgetOf(ctx, "2026-07", fuel)).toBeUndefined();

    await setBudget(ctx, {
      month: "2026-01",
      categoryId: food,
      amountMinor: 50_000,
      applies: "repeat",
    });
    await setBudget(ctx, {
      month: "2026-12",
      categoryId: food,
      amountMinor: 90_000,
      applies: "repeat",
      untilMonth: "2026-12",
    });
    expect((await budgetOf(ctx, "2026-12", food))?.budgetMinor).toBe(90_000);
    expect((await budgetOf(ctx, "2027-01", food))?.budgetMinor).toBe(50_000);

    const bad = (await setBudget(ctx, {
      month: "2026-05",
      categoryId: food,
      amountMinor: 1,
      applies: "repeat",
      untilMonth: "2026-04",
    }).catch((e: unknown) => e)) as AppError;
    expect(bad.code).toBe("VALIDATION");
  });

  it("this month only overrides the repeating budget for that month", async () => {
    const { ctx, food } = await setup();
    await setBudget(ctx, {
      month: "2026-01",
      categoryId: food,
      amountMinor: 50_000,
      applies: "repeat",
    });
    await setBudget(ctx, { month: "2026-12", categoryId: food, amountMinor: 80_000 });
    expect(await budgetOf(ctx, "2026-12", food)).toMatchObject({
      budgetMinor: 80_000,
      repeat: null,
    });
    expect((await budgetOf(ctx, "2027-01", food))?.budgetMinor).toBe(50_000);
    // Re-setting it as repeating from that month drops the override.
    await setBudget(ctx, {
      month: "2026-12",
      categoryId: food,
      amountMinor: 70_000,
      applies: "repeat",
    });
    expect(await budgetOf(ctx, "2026-12", food)).toMatchObject({
      budgetMinor: 70_000,
      repeat: { fromMonth: "2026-12", untilMonth: null },
    });
  });

  it("remove only this month: skips it; the budget continues the next month", async () => {
    const { ctx, food } = await setup();
    await setBudget(ctx, {
      month: "2026-01",
      categoryId: food,
      amountMinor: 50_000,
      applies: "repeat",
    });
    await removeBudget(ctx, { month: "2026-04", categoryId: food, scope: "month" });
    expect(await budgetOf(ctx, "2026-04", food)).toBeUndefined();
    expect((await budgetOf(ctx, "2026-03", food))?.budgetMinor).toBe(50_000);
    expect((await budgetOf(ctx, "2026-05", food))?.budgetMinor).toBe(50_000);
    // Copy last month into the skipped month brings it back as a one-month budget.
    expect((await copyLastMonth(ctx, "2026-04")).copied).toBe(1);
    expect(await budgetOf(ctx, "2026-04", food)).toMatchObject({
      budgetMinor: 50_000,
      repeat: null,
    });
  });

  it("remove this and later months: ends the budget; earlier months keep it", async () => {
    const { ctx, food } = await setup();
    await setBudget(ctx, {
      month: "2026-01",
      categoryId: food,
      amountMinor: 50_000,
      applies: "repeat",
    });
    await setBudget(ctx, {
      month: "2026-08",
      categoryId: food,
      amountMinor: 60_000,
      applies: "repeat",
    });
    await setBudget(ctx, { month: "2026-09", categoryId: food, amountMinor: 99_000 });
    await removeBudget(ctx, { month: "2026-05", categoryId: food, scope: "onwards" });
    expect((await budgetOf(ctx, "2026-04", food))?.repeat).toEqual({
      fromMonth: "2026-01",
      untilMonth: "2026-04",
    });
    for (const m of ["2026-05", "2026-08", "2026-09", "2027-01"]) {
      expect(await budgetOf(ctx, m, food)).toBeUndefined();
    }
  });

  it("one-month budgets work as before: remove deletes, copy last month copies", async () => {
    const { ctx, food } = await setup();
    await setBudget(ctx, { month: "2026-03", categoryId: food, amountMinor: 10_000 });
    expect(await budgetOf(ctx, "2026-04", food)).toBeUndefined();
    expect((await copyLastMonth(ctx, "2026-04")).copied).toBe(1);
    await removeBudget(ctx, { month: "2026-03", categoryId: food });
    expect(await budgetOf(ctx, "2026-03", food)).toBeUndefined();
    expect((await budgetOf(ctx, "2026-04", food))?.budgetMinor).toBe(10_000);
  });
});
