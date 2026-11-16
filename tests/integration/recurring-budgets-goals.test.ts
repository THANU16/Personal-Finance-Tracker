import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { CategoryModel } from "@/modules/categories/model";
import { copyLastMonth, getBudgetMonth, setBudget } from "@/modules/budgets/service";
import { createDebt } from "@/modules/debts/service";
import { getUpcoming } from "@/modules/dashboard/queries";
import {
  completeGoalCycle,
  createGoal,
  listGoals,
  setGoalArchived,
  skipGoalCycle,
  updateGoal,
} from "@/modules/goals/service";
import { RecurringRuleModel, type RecurringRuleDoc } from "@/modules/recurring/model";
import {
  confirmRule,
  createRule,
  listRules,
  listTemplates,
  setRuleStatus,
  skipRule,
} from "@/modules/recurring/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { AppError } from "@/server/errors";
import type { Ctx } from "@/server/ctx";
import {
  balanceOf,
  categoryId,
  makeAccount,
  makeHolding,
  makeUser,
  post,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);
const ruleDoc = async (ctx: Ctx, id: string) =>
  (await RecurringRuleModel.findOne({
    _id: new Types.ObjectId(id),
    userId: uid(ctx),
  }).lean<RecurringRuleDoc>())!;
const recurringTxns = (ctx: Ctx) =>
  TransactionModel.find({ userId: uid(ctx), "source.kind": "recurring" }).lean<TransactionDoc[]>();

describe("recurring rules", () => {
  it("confirm posts once (editable amount) and advances; a repeated confirm is refused", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 10_000_000 });
    const rent = await categoryId(ctx, "Rent", "expense").catch(() =>
      categoryId(ctx, "Housing", "expense"),
    );
    const { id } = await createRule(ctx, {
      name: "Rent",
      kind: "expense",
      amountMinor: 5_000_000,
      fromAccountId: bank.id,
      categoryId: rent,
      frequency: "monthly",
      dayOfMonth: 31,
      startDate: "2026-01-15",
    });
    expect((await ruleDoc(ctx, id)).nextDueDate).toBe("2026-01-31");

    const r = await confirmRule(ctx, id, { dueDate: "2026-01-31", amountMinor: 5_200_000 });
    expect(r.nextDueDate).toBe("2026-02-28");
    const txns = await recurringTxns(ctx);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: "expense", amountMinor: 5_200_000, description: "Rent" });
    expect(String(txns[0]!.source.refId)).toBe(id);
    expect(await balanceOf(ctx, bank.id)).toBe(4_800_000);

    const again = await confirmRule(ctx, id, { dueDate: "2026-01-31" }).catch((e: unknown) => e);
    expect((again as AppError).code).toBe("CONFLICT");
    expect(await recurringTxns(ctx)).toHaveLength(1);

    await skipRule(ctx, id, { dueDate: "2026-02-28" });
    expect((await ruleDoc(ctx, id)).nextDueDate).toBe("2026-03-31");
    expect(await recurringTxns(ctx)).toHaveLength(1);

    await setRuleStatus(ctx, id, "paused");
    await expect(confirmRule(ctx, id, { dueDate: "2026-03-31" })).rejects.toThrow(/not active/);
    expect((await listRules(ctx))[0]).toMatchObject({
      status: "paused",
      nextDueDate: "2026-03-31",
    });
  });

  it("an end date ends the rule after its last occurrence; income and transfer templates", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 1_000_000 });
    const cash = await makeAccount(ctx, { name: "Cash", type: "cash" });
    const salary = await categoryId(ctx, "Salary", "income");
    const { id } = await createRule(ctx, {
      name: "Salary",
      kind: "income",
      amountMinor: 25_000_000,
      toAccountId: bank.id,
      categoryId: salary,
      frequency: "monthly",
      dayOfMonth: 25,
      startDate: "2026-01-01",
      endDate: "2026-02-28",
    });
    await confirmRule(ctx, id, { dueDate: "2026-01-25" });
    const last = await confirmRule(ctx, id, { dueDate: "2026-02-25" });
    expect(last.nextDueDate).toBeNull();
    expect((await ruleDoc(ctx, id)).status).toBe("ended");
    expect(await balanceOf(ctx, bank.id)).toBe(51_000_000);

    await createRule(ctx, {
      name: "Pocket money",
      kind: "transfer",
      amountMinor: 500_000,
      fromAccountId: bank.id,
      toAccountId: cash.id,
      frequency: "weekly",
      weekday: 1,
      startDate: "2026-01-01",
    });
    expect((await listTemplates(ctx)).map((t) => t.name)).toEqual(["Pocket money"]);
  });

  it("a loan-payment rule splits interest/principal and replaces the loan's EMI in Upcoming", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 50_000_000 });
    const loan = await createDebt(ctx, {
      name: "Car loan",
      kind: "bank_loan",
      principalMinor: 100_000_000,
      annualRateBp: 1200,
      tenureMonths: 12,
      startDate: "2026-01-10",
      paymentDay: 10,
      paymentAccountId: bank.id,
      receivedIntoAccountId: bank.id,
    });
    const before = await getUpcoming(ctx, "2026-02-28");
    expect(before.filter((i) => i.kind === "emi").map((i) => i.dueDate)).toEqual(["2026-02-10"]);

    const { id } = await createRule(ctx, {
      name: "Car loan EMI",
      kind: "debt_payment",
      amountMinor: 8_884_879,
      fromAccountId: bank.id,
      debtId: loan.id,
      frequency: "monthly",
      dayOfMonth: 10,
      startDate: "2026-02-01",
    });
    const after = await getUpcoming(ctx, "2026-02-28");
    expect(after.filter((i) => i.kind === "emi")).toHaveLength(0);
    expect(
      after.filter((i) => i.kind === "recurring").map((i) => [i.dueDate, i.outflowMinor]),
    ).toEqual([["2026-02-10", 8_884_879]]);

    await confirmRule(ctx, id, { dueDate: "2026-02-10" });
    const [t] = await recurringTxns(ctx);
    expect(t).toMatchObject({
      type: "debt_payment",
      interestMinor: 1_000_000,
      principalMinor: 7_884_879,
    });
  });
});

describe("budgets", () => {
  async function categories(ctx: Ctx) {
    const userId = uid(ctx);
    const [food] = await CategoryModel.create([
      { userId, name: "Food test", kind: "expense", parentId: null },
    ]);
    const [groceries] = await CategoryModel.create([
      { userId, name: "Groceries test", kind: "expense", parentId: food!._id },
    ]);
    const [other] = await CategoryModel.create([
      { userId, name: "Other test", kind: "expense", parentId: null },
    ]);
    return {
      food: String(food!._id),
      groceries: String(groceries!._id),
      other: String(other!._id),
    };
  }

  it("actual includes child categories and split lines; unbudgeted shown; copy last month", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 10_000_000 });
    const c = await categories(ctx);
    await setBudget(ctx, { month: "2026-03", categoryId: c.food, amountMinor: 1_000_000 });
    await post(ctx, {
      type: "expense",
      date: "2026-03-02",
      amountMinor: 300_000,
      fromAccountId: bank.id,
      categoryId: c.food,
    });
    await post(ctx, {
      type: "expense",
      date: "2026-03-05",
      amountMinor: 600_000,
      fromAccountId: bank.id,
      splits: [
        { categoryId: c.groceries, amountMinor: 500_000 },
        { categoryId: c.other, amountMinor: 100_000 },
      ],
    });
    await post(ctx, {
      type: "expense",
      date: "2026-04-01",
      amountMinor: 999_999,
      fromAccountId: bank.id,
      categoryId: c.food,
    });

    const m = await getBudgetMonth(ctx, "2026-03");
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({
      categoryId: c.food,
      spentMinor: 800_000,
      remainingMinor: 200_000,
      usedBp: 8000,
      status: "warn",
    });
    expect(m.unbudgeted).toEqual([
      { categoryId: c.other, name: "Other test", spentMinor: 100_000 },
    ]);
    expect(m.monthSpentMinor).toBe(900_000);

    const copied = await copyLastMonth(ctx, "2026-04");
    expect(copied.copied).toBe(1);
    const april = await getBudgetMonth(ctx, "2026-04");
    expect(april.rows[0]).toMatchObject({
      budgetMinor: 1_000_000,
      spentMinor: 999_999,
      status: "warn",
    });
    expect((await copyLastMonth(ctx, "2026-04")).copied).toBe(0);

    const err = await setBudget(ctx, {
      month: "2026-03",
      categoryId: await categoryId(ctx, "Salary", "income"),
      amountMinor: 1,
    }).catch((e: unknown) => e);
    expect((err as AppError).code).toBe("VALIDATION");
  });
});

describe("goals", () => {
  it("current = Σ value × share; required monthly; shares capped at 100% per item", async () => {
    const ctx = await makeUser();
    const savings = await makeAccount(ctx, { name: "Savings", openingBalanceMinor: 20_000_000 });
    const fund = await makeHolding(ctx, {
      name: "Fund",
      investedMinor: 10_000_000,
      currentValueMinor: 12_000_000,
    });
    const today = new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const in12 = `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
    await createGoal(ctx, {
      name: "House deposit",
      targetMinor: 100_000_000,
      targetDate: in12,
      links: [
        { kind: "account", refId: savings.id, shareBp: 5000 },
        { kind: "holding", refId: fund.id, shareBp: 10_000 },
      ],
    });
    const { goals, options } = await listGoals(ctx);
    expect(goals[0]).toMatchObject({
      currentMinor: 22_000_000,
      shortfallMinor: 78_000_000,
      status: "off_track",
    });
    expect(goals[0]!.requiredMonthlyMinor).toBeGreaterThan(0);
    expect(options.find((o) => o.id === savings.id)?.usedBp).toBe(5000);

    const err = await createGoal(ctx, {
      name: "Car",
      targetMinor: 1_000_000,
      targetDate: in12,
      links: [{ kind: "account", refId: savings.id, shareBp: 6000 }],
    }).catch((e: unknown) => e);
    expect((err as AppError).message).toMatch(/50% of this item/);

    await createGoal(ctx, {
      name: "Trip",
      targetMinor: 5_000_000,
      targetDate: in12,
      links: [{ kind: "account", refId: savings.id, shareBp: 5000 }],
    });
    const trip = (await listGoals(ctx)).goals.find((g) => g.name === "Trip")!;
    expect(trip).toMatchObject({
      currentMinor: 10_000_000,
      status: "achieved",
      requiredMonthlyMinor: 0,
    });
  });
});

describe("repeating goals", () => {
  const find = async (ctx: Ctx, id: string) =>
    (await listGoals(ctx)).goals.find((g) => g.id === id)!;

  it("a yearly goal: complete a cycle → history saved, due date moves exactly one year", async () => {
    const ctx = await makeUser();
    const savings = await makeAccount(ctx, { name: "Savings", openingBalanceMinor: 15_000_000 });
    const { id } = await createGoal(ctx, {
      name: "Insurance premium",
      targetMinor: 15_000_000,
      targetDate: "2027-03-01",
      kind: "recurring",
      recurrence: { every: 1, unit: "year" },
      links: [{ kind: "account", refId: savings.id, shareBp: 10_000 }],
    });
    expect(await find(ctx, id)).toMatchObject({
      kind: "recurring",
      recurrence: { every: 1, unit: "year", label: "Every year" },
      cycleNo: 0,
      targetDate: "2027-03-01",
      currentMinor: 15_000_000,
      status: "achieved",
      cycles: [],
    });

    const r = await completeGoalCycle(ctx, id);
    expect(r.nextDueDate).toBe("2028-03-01");
    const g = await find(ctx, id);
    expect(g).toMatchObject({ cycleNo: 1, targetDate: "2028-03-01", targetMinor: 15_000_000 });
    expect(g.cycles).toEqual([
      expect.objectContaining({
        cycleNo: 0,
        dueDate: "2027-03-01",
        targetMinor: 15_000_000,
        currentAtCloseMinor: 15_000_000,
        status: "completed",
      }),
    ]);
  });

  it("every 8 months; skip records a skipped cycle; one-time goals have no cycles", async () => {
    const ctx = await makeUser();
    const { id } = await createGoal(ctx, {
      name: "Car service",
      targetMinor: 50_000,
      targetDate: "2026-12-05",
      kind: "recurring",
      recurrence: { every: 8, unit: "month" },
    });
    await skipGoalCycle(ctx, id);
    await completeGoalCycle(ctx, id);
    const g = await find(ctx, id);
    expect(g).toMatchObject({
      cycleNo: 2,
      targetDate: "2028-04-05",
      recurrence: { label: "Every 8 months" },
    });
    expect(g.cycles.map((c) => [c.cycleNo, c.dueDate, c.status])).toEqual([
      [1, "2027-08-05", "completed"],
      [0, "2026-12-05", "skipped"],
    ]);

    const once = await createGoal(ctx, {
      name: "Laptop",
      targetMinor: 1,
      targetDate: "2027-01-01",
    });
    expect(await find(ctx, once.id)).toMatchObject({
      kind: "one_time",
      recurrence: null,
      cycles: [],
    });
    expect(
      ((await completeGoalCycle(ctx, once.id).catch((e: unknown) => e)) as AppError).code,
    ).toBe("CONFLICT");
  });

  it("every 2 years; editing the due date re-anchors, an unchanged edit keeps the schedule", async () => {
    const ctx = await makeUser();
    const base = {
      name: "Licence",
      targetMinor: 20_000,
      kind: "recurring" as const,
      recurrence: { every: 2, unit: "year" as const },
    };
    const { id } = await createGoal(ctx, { ...base, targetDate: "2027-01-31" });
    await completeGoalCycle(ctx, id);
    expect((await find(ctx, id)).targetDate).toBe("2029-01-31");
    // Saving without changing the date or period keeps the anchor.
    await updateGoal(ctx, id, { ...base, name: "Vehicle licence", targetDate: "2029-01-31" });
    await completeGoalCycle(ctx, id);
    expect((await find(ctx, id)).targetDate).toBe("2031-01-31");
    // A new due date re-anchors from the current cycle.
    await updateGoal(ctx, id, { ...base, targetDate: "2031-06-15" });
    await completeGoalCycle(ctx, id);
    expect((await find(ctx, id)).targetDate).toBe("2033-06-15");
    // Switching back to one-time drops the schedule but keeps the history.
    await updateGoal(ctx, id, {
      ...base,
      kind: "one_time",
      recurrence: null,
      targetDate: "2034-01-01",
    });
    expect(await find(ctx, id)).toMatchObject({ kind: "one_time", recurrence: null });
    expect((await find(ctx, id)).cycles).toHaveLength(3);
  });

  it("repeating needs a period; archived goals cannot close a cycle", async () => {
    const ctx = await makeUser();
    const bad = (await createGoal(ctx, {
      name: "X",
      targetMinor: 1,
      targetDate: "2027-01-01",
      kind: "recurring",
    }).catch((e: unknown) => e)) as AppError;
    expect(bad.code).toBe("VALIDATION");
    expect(bad.fieldErrors?.recurrence).toBeDefined();
    const { id } = await createGoal(ctx, {
      name: "Y",
      targetMinor: 1,
      targetDate: "2027-01-01",
      kind: "recurring",
      recurrence: { every: 1, unit: "year" },
    });
    await setGoalArchived(ctx, id, true);
    expect(((await completeGoalCycle(ctx, id).catch((e: unknown) => e)) as AppError).code).toBe(
      "CONFLICT",
    );
  });
});
