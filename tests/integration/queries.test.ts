import { beforeEach, describe, expect, it } from "vitest";
import { getAccountDetail, getAccountsOverview } from "@/modules/accounts/queries";
import { listTransactions } from "@/modules/transactions/queries";
import { transactionFiltersSchema } from "@/modules/transactions/schemas";
import { voidTransaction } from "@/modules/transactions/service";
import type { AccountDTO } from "@/modules/accounts/schemas";
import type { Ctx } from "@/server/ctx";
import { categoryId, makeAccount, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const TODAY = "2026-03-20";
const filters = (params: Record<string, string> = {}) => transactionFiltersSchema.parse(params);

let ctx: Ctx;
let bank: AccountDTO;
let card: AccountDTO;
let usd: AccountDTO;
let voidedId: string;

beforeEach(async () => {
  ctx = await makeUser();
  bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 1_000_000 });
  card = await makeAccount(ctx, {
    name: "Card",
    type: "credit_card",
    creditCard: { limitMinor: 500_000, statementDay: 20, dueDay: 5 },
  });
  usd = await makeAccount(ctx, { name: "USD", currency: "USD", type: "wallet" });
  const groceries = await categoryId(ctx, "Groceries");
  const restaurants = await categoryId(ctx, "Restaurants");
  const rent = await categoryId(ctx, "Rent");
  await post(ctx, {
    type: "income",
    date: "2026-03-01",
    amountMinor: 300_000,
    toAccountId: bank.id,
    categoryId: await categoryId(ctx, "Salary"),
    description: "March salary",
  });
  await post(ctx, {
    type: "expense",
    date: "2026-03-02",
    amountMinor: 12_000,
    fromAccountId: card.id,
    categoryId: groceries,
    tags: ["Family"],
    counterparty: "Keells",
  });
  await post(ctx, {
    type: "expense",
    date: "2026-03-05",
    amountMinor: 8_000,
    fromAccountId: bank.id,
    splits: [
      { categoryId: restaurants, amountMinor: 5_000 },
      { categoryId: rent, amountMinor: 3_000 },
    ],
  });
  await post(ctx, {
    type: "transfer",
    date: "2026-03-10",
    amountMinor: 12_000,
    fromAccountId: bank.id,
    toAccountId: card.id,
  });
  await post(ctx, {
    type: "expense",
    date: "2026-02-15",
    amountMinor: 2_000,
    fromAccountId: bank.id,
    categoryId: groceries,
  });
  await post(ctx, {
    type: "expense",
    date: "2026-03-12",
    amountMinor: 900,
    fromAccountId: usd.id,
    categoryId: groceries,
  });
  voidedId = await post(ctx, {
    type: "expense",
    date: "2026-03-15",
    amountMinor: 50_000,
    fromAccountId: bank.id,
    categoryId: rent,
  });
  await voidTransaction(ctx, voidedId, { reason: "Duplicate" });
});

describe("listTransactions", () => {
  it("defaults to this month, newest first, posted only, with a base-currency summary", async () => {
    const res = await listTransactions(ctx, filters(), TODAY);
    expect(res.range).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(res.rows.map((r) => r.date)).toEqual([
      "2026-03-12",
      "2026-03-10",
      "2026-03-05",
      "2026-03-02",
      "2026-03-01",
    ]);
    expect(res.summary).toEqual({
      currency: "LKR",
      incomeMinor: 300_000,
      expenseMinor: 20_000,
      netMinor: 280_000,
      otherCurrencyCount: 1,
    });
    const transfer = res.rows.find((r) => r.type === "transfer")!;
    expect(transfer.fromAccount?.name).toBe("Bank");
    expect(transfer.toAccount?.name).toBe("Card");
    expect(res.rows.find((r) => r.splits.length)?.splits.map((s) => s.category.name)).toEqual([
      "Restaurants",
      "Rent",
    ]);
  });

  it("filters by account, category (incl. children and split lines), tag, amount and text", async () => {
    const byAccount = await listTransactions(ctx, filters({ account: card.id }), TODAY);
    expect(byAccount.rows.map((r) => r.amountMinor)).toEqual([12_000, 12_000]);

    const food = await categoryId(ctx, "Food & Dining");
    const byCategory = await listTransactions(
      ctx,
      filters({ category: food, preset: "all" }),
      TODAY,
    );
    expect(byCategory.rows.map((r) => r.amountMinor).sort((a, b) => a - b)).toEqual([
      900, 2_000, 8_000, 12_000,
    ]);

    expect((await listTransactions(ctx, filters({ tag: "family" }), TODAY)).rows).toHaveLength(1);
    expect(
      (await listTransactions(ctx, filters({ min: "10000", max: "20000" }), TODAY)).rows,
    ).toHaveLength(2);
    expect((await listTransactions(ctx, filters({ q: "keel" }), TODAY)).rows[0]?.counterparty).toBe(
      "Keells",
    );
    expect((await listTransactions(ctx, filters({ q: "salary" }), TODAY)).rows).toHaveLength(1);
    expect(
      (await listTransactions(ctx, filters({ types: "transfer" }), TODAY)).summary.expenseMinor,
    ).toBe(0);
  });

  it("includes voided rows only on request and marks them not editable", async () => {
    const res = await listTransactions(ctx, filters({ voided: "1" }), TODAY);
    const voided = res.rows.find((r) => r.id === voidedId)!;
    expect(voided.status).toBe("void");
    expect(voided.voidReason).toBe("Duplicate");
    expect(voided.editable).toBe(false);
    expect(res.summary.expenseMinor).toBe(20_000);
  });

  it("supports presets, custom ranges and safe defaults for junk params", async () => {
    expect(
      (await listTransactions(ctx, filters({ preset: "last_month" }), TODAY)).rows,
    ).toHaveLength(1);
    expect(
      (
        await listTransactions(
          ctx,
          filters({ preset: "custom", from: "2026-03-02", to: "2026-03-05" }),
          TODAY,
        )
      ).total,
    ).toBe(2);
    const junk = filters({ preset: "nope", page: "-3", min: "abc", types: "bogus" });
    expect(junk).toMatchObject({ preset: "this_month", page: 1, types: [] });
    expect(junk.min).toBeUndefined();
  });

  it("never shows another user's transactions", async () => {
    const other = await makeUser();
    expect((await listTransactions(other, filters({ preset: "all" }), TODAY)).total).toBe(0);
    await expect(
      listTransactions(other, filters({ category: await categoryId(ctx, "Rent") }), TODAY),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("account queries", () => {
  it("groups accounts with per-currency subtotals", async () => {
    const { groups } = await getAccountsOverview(ctx);
    expect(groups.map((g) => g.label)).toEqual(["Cash & bank", "Cards"]);
    expect(groups[0]!.subtotals).toEqual([
      { currency: "LKR", totalMinor: 1_000_000 + 300_000 - 8_000 - 12_000 - 2_000 },
      { currency: "USD", totalMinor: -900 },
    ]);
    expect(groups[1]!.accounts[0]!.card).toMatchObject({ outstandingMinor: 0, utilisationBp: 0 });
  });

  it("gives a running balance newest-first and a daily history", async () => {
    const detail = await getAccountDetail(ctx, bank.id);
    expect(detail.rows.map((r) => [r.txn.date, r.deltaMinor, r.balanceMinor])).toEqual([
      ["2026-03-10", -12_000, 1_278_000],
      ["2026-03-05", -8_000, 1_290_000],
      ["2026-03-01", 300_000, 1_298_000],
      ["2026-02-15", -2_000, 998_000],
    ]);
    expect(detail.history.slice(0, 5)).toEqual([
      { date: "2026-01-01", balanceMinor: 1_000_000 },
      { date: "2026-02-15", balanceMinor: 998_000 },
      { date: "2026-03-01", balanceMinor: 1_298_000 },
      { date: "2026-03-05", balanceMinor: 1_290_000 },
      { date: "2026-03-10", balanceMinor: 1_278_000 },
    ]);
    expect(detail.account.balanceMinor).toBe(1_278_000);
  });
});
