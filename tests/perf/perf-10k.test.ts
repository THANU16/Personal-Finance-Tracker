import { appendFileSync } from "node:fs";
import { Types } from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { parseRangeView } from "@/domain/date-range";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { ValuationModel } from "@/modules/holdings/model";
import { TransactionModel } from "@/modules/transactions/model";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import { categoryId, makeAccount, makeHolding, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Phase 12 acceptance: "dashboard < 1 s with 10k transactions" + the hot queries use indexes.
// React's cache() dedupes per request in the app; emulate it here (see dashboard-perf.test.ts).
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

const N = 10_000;

async function bigUser() {
  const ctx = await makeUser();
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const start = new Date(businessDateToUtc(today, ctx.tz).getTime() - 540 * 86_400_000);
  const startKey = utcToBusinessDate(start, ctx.tz);
  const bank = await makeAccount(ctx, {
    openingBalanceMinor: 50_000_000_00,
    openingDate: startKey,
  });
  const cash = await makeAccount(ctx, {
    type: "cash",
    openingBalanceMinor: 100_000_00,
    openingDate: startKey,
  });
  const holdings = await Promise.all(
    [0, 1, 2, 3].map((i) =>
      makeHolding(ctx, {
        name: `Fund ${i}`,
        openingDate: startKey,
        investedMinor: 1_000_000_00,
        currentValueMinor: 1_000_000_00,
      }),
    ),
  );
  const uid = new Types.ObjectId(ctx.userId);
  const groceries = new Types.ObjectId(await categoryId(ctx, "Groceries"));
  const rent = new Types.ObjectId(await categoryId(ctx, "Rent"));
  const salary = new Types.ObjectId(await categoryId(ctx, "Salary"));
  const bankId = new Types.ObjectId(bank.id);
  const cashId = new Types.ObjectId(cash.id);
  const at = (i: number) => new Date(start.getTime() + 86_400_000 + (i % 535) * 86_400_000);
  await TransactionModel.insertMany(
    Array.from({ length: N }, (_, i) => {
      const base = {
        userId: uid,
        date: at(i),
        currency: "LKR",
        splits: [],
        source: { kind: "import", refId: null },
        status: "posted",
        createdAt: new Date(at(i).getTime() + i),
      };
      switch (i % 20) {
        case 0:
          return {
            ...base,
            type: "income",
            amountMinor: 250_000_00,
            toAccountId: bankId,
            categoryId: salary,
          };
        case 1:
          return {
            ...base,
            type: "expense",
            amountMinor: 85_000_00,
            fromAccountId: bankId,
            categoryId: rent,
          };
        case 2:
          return {
            ...base,
            type: "transfer",
            amountMinor: 20_000_00,
            fromAccountId: bankId,
            toAccountId: cashId,
          };
        case 3:
          return {
            ...base,
            type: "invest",
            amountMinor: 10_000_00,
            feeMinor: 0,
            fromAccountId: bankId,
            holdingId: new Types.ObjectId(holdings[i % 4]!.id),
          };
        default:
          return {
            ...base,
            type: "expense",
            amountMinor: 500_00 + (i % 97) * 10,
            fromAccountId: i % 2 ? bankId : cashId,
            categoryId: groceries,
          };
      }
    }),
  );
  await ValuationModel.insertMany(
    holdings.flatMap((h, hi) =>
      Array.from({ length: 18 }, (_, m) => ({
        userId: uid,
        holdingId: new Types.ObjectId(h.id),
        date: new Date(start.getTime() + (m + 1) * 30 * 86_400_000),
        valueMinor: Math.round((1_000_000_00 + m * 30_000_00) * (1 + hi * 0.01)),
        source: "manual",
      })),
    ),
  );
  await recomputeAllForUser(ctx);
  return { ctx, uid, bankId, holdingId: new Types.ObjectId(holdings[0]!.id), today };
}

/** Every stage name in an explain plan tree. */
function stages(plan: unknown): string[] {
  if (!plan || typeof plan !== "object") return [];
  const p = plan as Record<string, unknown>;
  const own = typeof p.stage === "string" ? [p.stage] : [];
  return [
    ...own,
    ...stages(p.inputStage),
    ...((p.inputStages as unknown[]) ?? []).flatMap(stages),
    ...stages(p.queryPlan),
  ];
}

const winningStages = (explain: unknown): string[] => {
  const e = explain as {
    queryPlanner?: { winningPlan?: unknown };
    stages?: { $cursor?: { queryPlanner?: { winningPlan?: unknown } } }[];
  };
  if (e.queryPlanner) return stages(e.queryPlanner.winningPlan);
  return stages(e.stages?.[0]?.$cursor?.queryPlanner?.winningPlan);
};

describe("10k transactions (Phase 12 acceptance)", () => {
  it("one dashboard request runs in under 1 s and the hot queries use indexes", async () => {
    const q = await import("@/modules/dashboard/queries");
    const { ctx, uid, bankId, holdingId, today } = await bigUser();
    expect(await TransactionModel.countDocuments({ userId: uid })).toBeGreaterThanOrEqual(N);

    const v = parseRangeView({ r: "1y" }, today);
    const request = (c: typeof ctx) =>
      Promise.all([
        q.netWorthSeries(c, v),
        q.cashflowSeries(c, { ...v, compare: true }),
        q.topExpenseCategories(c, v.range),
        q.allocationAsOf(c, v.range.to),
        q.getStanding(c, v),
        q.getSafeToSpend(c),
        q.getAttention(c),
      ]);
    await request(ctx); // warm-up
    const started = performance.now();
    await request({ ...ctx });
    const ms = performance.now() - started;
    // PERF_OUT=<file> records the measurement (evidence for docs/PROGRESS.md).
    if (process.env.PERF_OUT)
      appendFileSync(
        process.env.PERF_OUT,
        `dashboard 10k: ${Math.round(ms)} ms` + String.fromCharCode(10),
      );
    expect(ms).toBeLessThan(1_000);

    // explain(): no collection scans on the hot paths (indexes per docs/03)
    const from = businessDateToUtc(v.range.from, ctx.tz);
    const plans = await Promise.all([
      TransactionModel.find({ userId: uid, status: "posted", date: { $gte: from } }).explain(
        "queryPlanner",
      ),
      TransactionModel.find({
        userId: uid,
        $or: [{ fromAccountId: bankId }, { toAccountId: bankId }],
      }).explain("queryPlanner"),
      TransactionModel.find({ userId: uid, holdingId, status: "posted" }).explain("queryPlanner"),
      ValuationModel.find({ userId: uid, holdingId }).sort({ date: -1 }).explain("queryPlanner"),
      TransactionModel.aggregate([
        {
          $match: {
            userId: uid,
            status: "posted",
            type: { $in: ["income", "expense"] },
            date: { $gte: from },
          },
        },
        { $group: { _id: "$type", s: { $sum: "$amountMinor" } } },
      ]).explain("queryPlanner"),
    ]);
    for (const p of plans) {
      const s = winningStages(p);
      expect(s.length, JSON.stringify(p).slice(0, 300)).toBeGreaterThan(0);
      expect(s).not.toContain("COLLSCAN");
    }
  }, 300_000);
});
