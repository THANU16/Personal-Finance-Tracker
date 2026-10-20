import { Types } from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { parseRangeView } from "@/domain/date-range";
import { utcToBusinessDate } from "@/domain/dates";
import { TransactionModel } from "@/modules/transactions/model";
import { categoryId, makeAccount, makeHolding, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// One dashboard request: in the app React's cache() dedupes the ledger load across widgets within a
// request. Outside a server render it does not memoise, so emulate it here (this file only).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<unknown, R>();
      return (...args: A) => {
        const key = args[0];
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key)!;
      };
    },
  };
});

setupTestDb();

describe("dashboard performance (docs/06 Phase 4 acceptance)", () => {
  it("one request's queries for 1Y with ~3,000 transactions run in under 1 s", async () => {
    const {
      allocationAsOf,
      cashflowSeries,
      getSafeToSpend,
      getStanding,
      netWorthSeries,
      topExpenseCategories,
    } = await import("@/modules/dashboard/queries");
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, {
      openingBalanceMinor: 5_000_000_00,
      openingDate: "2025-01-01",
    });
    await makeHolding(ctx, {
      openingDate: "2025-01-01",
      investedMinor: 100_000_00,
      currentValueMinor: 100_000_00,
    });
    const uid = new Types.ObjectId(ctx.userId);
    const groceries = new Types.ObjectId(await categoryId(ctx, "Groceries"));
    const salary = new Types.ObjectId(await categoryId(ctx, "Salary"));
    await TransactionModel.insertMany(
      Array.from({ length: 3_000 }, (_, i) => {
        const income = i % 10 === 0;
        return {
          userId: uid,
          type: income ? "income" : "expense",
          date: new Date(Date.UTC(2025, 3, 1) + (i % 360) * 86_400_000 - 5.5 * 3_600_000),
          amountMinor: income ? 50_000 : 1_000 + (i % 97),
          currency: "LKR",
          fromAccountId: income ? null : new Types.ObjectId(bank.id),
          toAccountId: income ? new Types.ObjectId(bank.id) : null,
          categoryId: income ? salary : groceries,
          splits: [],
          source: { kind: "import", refId: null },
          status: "posted",
        };
      }),
    );
    const v = parseRangeView({ r: "1y" }, utcToBusinessDate(new Date(), ctx.tz));
    const request = () =>
      Promise.all([
        netWorthSeries(ctx, v),
        cashflowSeries(ctx, { ...v, compare: true }),
        topExpenseCategories(ctx, v.range),
        allocationAsOf(ctx, v.range.to),
        getStanding(ctx, v),
        getSafeToSpend(ctx),
      ]);
    await request(); // warm-up (JIT, connection pool), like a server that has served a page before
    const ctx2 = { ...ctx }; // a new request = a new ctx object = a fresh request cache
    const started = performance.now();
    await Promise.all([
      netWorthSeries(ctx2, v),
      cashflowSeries(ctx2, { ...v, compare: true }),
      topExpenseCategories(ctx2, v.range),
      allocationAsOf(ctx2, v.range.to),
      getStanding(ctx2, v),
      getSafeToSpend(ctx2),
    ]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
