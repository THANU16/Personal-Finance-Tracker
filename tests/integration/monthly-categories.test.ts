import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { reportCsv } from "@/modules/reports/csv";
import { MonthlyReviewModel } from "@/modules/reports/model";
import { computeMonthlyReview, getMonthlySummary } from "@/modules/reports/service";
import { categoryId, makeAccount, makeHolding, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Owner request: the monthly summary lists every expense AND income category (top 5 shown first).

setupTestDb();

async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { openingBalanceMinor: 1_000_000 });
  const fund = await makeHolding(ctx, { investedMinor: 100_000, currentValueMinor: 100_000 });
  const income = (name: string, date: string, amountMinor: number) =>
    categoryId(ctx, name, "income").then((c) =>
      post(ctx, { type: "income", date, amountMinor, toAccountId: bank.id, categoryId: c }),
    );
  await income("Salary", "2026-08-25", 200_000);
  await income("Salary", "2026-09-25", 250_000);
  await income("Bonus", "2026-09-26", 40_000);
  await post(ctx, {
    type: "investment_income",
    date: "2026-09-10",
    amountMinor: 10_000,
    taxMinor: 1_000,
    incomeKind: "dividend",
    toAccountId: bank.id,
    holdingId: fund.id,
  });
  // Reinvested income is not cashflow income (docs/04 §4).
  await post(ctx, {
    type: "investment_income",
    date: "2026-09-11",
    amountMinor: 5_000,
    incomeKind: "distribution",
    reinvest: true,
    holdingId: fund.id,
  });
  const names = [
    "Health",
    "Shopping",
    "Entertainment",
    "Education",
    "Personal care",
    "Gifts & donations",
  ];
  for (const [i, n] of names.entries()) {
    const c = await categoryId(ctx, n, "expense");
    await post(ctx, {
      type: "expense",
      date: "2026-09-05",
      amountMinor: 1_000 * (i + 1),
      fromAccountId: bank.id,
      categoryId: c,
    });
  }
  return { ctx };
}

describe("monthly summary categories", () => {
  it("income by category (payouts as one row) and every expense category sum to the totals", async () => {
    const { ctx } = await setup();
    const r = await computeMonthlyReview(ctx, "2026-09");

    expect(r.incomeMinor).toBe(300_000);
    expect(r.incomeCategories.map((c) => [c.name, c.amountMinor, c.previousMinor])).toEqual([
      ["Salary", 250_000, 200_000],
      ["Bonus", 40_000, 0],
      ["Investment income", 10_000, 0],
    ]);
    expect(r.incomeCategories[0]!.changeBp).toBe(2_500);

    expect(r.expenseCategories.length).toBeGreaterThan(5);
    expect(r.expenseCategories.reduce((s, c) => s + c.amountMinor, 0)).toBe(r.expenseMinor);
    const amounts = r.expenseCategories.map((c) => c.amountMinor);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));

    const csv = (await reportCsv(ctx, "monthly", { month: "2026-09" })).csv;
    expect(csv).toContain("Income: Investment income,100.00");
    expect(csv.match(/^Expense: /gm)).toHaveLength(r.expenseCategories.length);
  });

  it("a review saved before the lists existed gets them from the ledger", async () => {
    const { ctx } = await setup();
    const full = await computeMonthlyReview(ctx, "2026-09");
    const legacy: Partial<typeof full> = { ...full };
    delete legacy.expenseCategories;
    delete legacy.incomeCategories;
    await MonthlyReviewModel.create({
      userId: new Types.ObjectId(ctx.userId),
      month: "2026-09",
      generatedAt: new Date(),
      data: { ...legacy, topCategories: full.expenseCategories.slice(0, 5) },
    });
    const s = await getMonthlySummary(ctx, "2026-09");
    expect(s.generatedAt).not.toBeNull();
    expect(s.review.expenseCategories).toEqual(full.expenseCategories);
    expect(s.review.incomeCategories).toEqual(full.incomeCategories);
    expect(s.review).not.toHaveProperty("topCategories");
  });
});
