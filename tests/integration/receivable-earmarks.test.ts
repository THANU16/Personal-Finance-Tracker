import { describe, expect, it } from "vitest";
import { getAccountBuckets, getBucketsInBase, setEarmark } from "@/modules/earmarks/service";
import { getEmergency } from "@/modules/essentials/service";
import { getOpportunityOverview } from "@/modules/opportunity-fund/service";
import { createTransaction } from "@/modules/transactions/service";
import type { Ctx } from "@/server/ctx";
import { makeAccount, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Owner request: money lent out of the emergency / opportunity fund stays that money while it is owed.

setupTestDb();

async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, {
    name: "Bank",
    openingBalanceMinor: 500_000,
    openingDate: "2026-01-01",
  });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "emergency",
    mode: "fixed",
    amountMinor: 200_000,
  });
  const loan = await makeAccount(ctx, {
    name: "Loan to Kasun",
    type: "receivable",
    counterparty: "Kasun",
    openingBalanceMinor: 0,
    openingDate: "2026-01-01",
  });
  return { ctx, bank, loan };
}

const buckets = async (ctx: Ctx, id: string) => {
  const b = await getAccountBuckets(ctx, id);
  return { emergency: b.emergencyMinor, opportunity: b.opportunityMinor, free: b.freeMinor };
};

describe("receivables carry earmarks", () => {
  it("lend from emergency → repay part untagged (shrinks, no question) → repay the rest back into emergency", async () => {
    const { ctx, bank, loan } = await setup();
    const before = await getBucketsInBase(ctx);

    // Lend 50,000 out of the emergency fund
    await createTransaction(ctx, {
      type: "transfer",
      date: "2026-02-01",
      amountMinor: 50_000,
      fromAccountId: bank.id,
      toAccountId: loan.id,
      fromBucket: "emergency",
      toBucket: "emergency",
    });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 150_000,
      opportunity: 0,
      free: 300_000,
    });
    expect(await buckets(ctx, loan.id)).toEqual({ emergency: 50_000, opportunity: 0, free: 0 });

    // Totals: emergency still 200,000; the receivable is never free cash
    const after = await getBucketsInBase(ctx);
    expect(after.emergencyMinor).toBe(before.emergencyMinor);
    expect(after.freeMinor).toBe(300_000);

    // Essentials: counted, but not available until repaid
    const e = await getEmergency(ctx);
    expect(e.sources.find((s) => s.id === loan.id)).toMatchObject({
      name: "Loan to Kasun (lent out)",
      valueMinor: 50_000,
      available: false,
    });

    // Repay 20,000 without a tag: no confirmation; the earmark shrinks to what is still owed
    await createTransaction(ctx, {
      type: "transfer",
      date: "2026-03-01",
      amountMinor: 20_000,
      fromAccountId: loan.id,
      toAccountId: bank.id,
    });
    expect(await buckets(ctx, loan.id)).toEqual({ emergency: 30_000, opportunity: 0, free: 0 });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 150_000,
      opportunity: 0,
      free: 320_000,
    });

    // Repay the last 30,000 tagged: back into the bank's emergency money
    await createTransaction(ctx, {
      type: "transfer",
      date: "2026-04-01",
      amountMinor: 30_000,
      fromAccountId: loan.id,
      toAccountId: bank.id,
      fromBucket: "emergency",
      toBucket: "emergency",
    });
    expect(await buckets(ctx, loan.id)).toEqual({ emergency: 0, opportunity: 0, free: 0 });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 180_000,
      opportunity: 0,
      free: 320_000,
    });
  });

  it("lent opportunity money counts in the fund but is not a deployment source", async () => {
    const { ctx, bank, loan } = await setup();
    await setEarmark(ctx, {
      accountId: bank.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 100_000,
    });
    await createTransaction(ctx, {
      type: "transfer",
      date: "2026-02-01",
      amountMinor: 40_000,
      fromAccountId: bank.id,
      toAccountId: loan.id,
      fromBucket: "opportunity",
      toBucket: "opportunity",
    });
    const o = await getOpportunityOverview(ctx);
    expect(o.fundBalanceMinor).toBe(100_000);
    expect(o.sources.map((s) => s.id)).toEqual([bank.id]);
    expect(o.sources[0]!.opportunityMinor).toBe(60_000);
  });
});
