import { describe, expect, it } from "vitest";
import { getAccountBuckets, setEarmark } from "@/modules/earmarks/service";
import { TransactionModel } from "@/modules/transactions/model";
import {
  createTransaction,
  updateTransaction,
  voidTransaction,
} from "@/modules/transactions/service";
import type { Ctx } from "@/server/ctx";
import type { AppError } from "@/server/errors";
import { balanceOf, categoryId, makeAccount, makeHolding, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Owner request: a transaction can optionally say which bucket its money leaves from / arrives in.
// Default (no bucket) = free cash, exactly as before.

setupTestDb();

/** docs/04 §20 example: Commercial Bank 350,000 / emergency 100,000 / opportunity 200,000 / free 50,000. */
async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, {
    name: "Commercial Bank",
    openingBalanceMinor: 350_000,
    openingDate: "2026-01-01",
  });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "emergency",
    mode: "fixed",
    amountMinor: 100_000,
  });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "opportunity",
    mode: "fixed",
    amountMinor: 200_000,
  });
  return { ctx, bank };
}

const buckets = async (ctx: Ctx, id: string) => {
  const b = await getAccountBuckets(ctx, id);
  return { emergency: b.emergencyMinor, opportunity: b.opportunityMinor, free: b.freeMinor };
};

describe("bucket tags on transactions", () => {
  it("no bucket = normal: income goes to free cash, earmarks untouched", async () => {
    const { ctx, bank } = await setup();
    await createTransaction(ctx, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 20_000,
      toAccountId: bank.id,
      categoryId: await categoryId(ctx, "Salary"),
    });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 200_000,
      free: 70_000,
    });
  });

  it("income into Emergency grows the emergency earmark; void takes it back out", async () => {
    const { ctx, bank } = await setup();
    const { id } = await createTransaction(ctx, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 20_000,
      toAccountId: bank.id,
      categoryId: await categoryId(ctx, "Salary"),
      toBucket: "emergency",
    });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 120_000,
      opportunity: 200_000,
      free: 50_000,
    });
    const doc = await TransactionModel.findOne({ _id: id, userId: ctx.userId }).lean();
    expect(doc).toMatchObject({ toBucket: "emergency", fromBucket: null });

    await voidTransaction(ctx, id, { reason: "test" });
    expect(await balanceOf(ctx, bank.id)).toBe(350_000);
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 200_000,
      free: 50_000,
    });
  });

  it("an expense from Opportunity lowers only opportunity (no dip warning even above free cash)", async () => {
    const { ctx, bank } = await setup();
    const groceries = await categoryId(ctx, "Groceries");
    const { id } = await createTransaction(ctx, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 80_000, // more than the 50,000 free
      fromAccountId: bank.id,
      categoryId: groceries,
      fromBucket: "opportunity",
    });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 120_000,
      free: 50_000,
    });

    // Edit to 30,000: the earmark follows the new amount
    const { id: edited } = await updateTransaction(ctx, id, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 30_000,
      fromAccountId: bank.id,
      categoryId: groceries,
      fromBucket: "opportunity",
    });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 170_000,
      free: 50_000,
    });

    // Void: the money and the earmark come back
    await voidTransaction(ctx, edited, { reason: "test" });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 200_000,
      free: 50_000,
    });
  });

  it("paying more than the bucket holds is refused and nothing is posted", async () => {
    const { ctx, bank } = await setup();
    await expect(
      createTransaction(ctx, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 100_001,
        fromAccountId: bank.id,
        categoryId: await categoryId(ctx, "Groceries"),
        fromBucket: "emergency",
      }),
    ).rejects.toThrow(/has only LKR 1,000\.00 of emergency money/);
    expect(await balanceOf(ctx, bank.id)).toBe(350_000);
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 200_000,
      free: 50_000,
    });
  });

  it("a transfer moves emergency money between accounts (fee from the bucket too)", async () => {
    const { ctx, bank } = await setup();
    const savings = await makeAccount(ctx, {
      name: "NSB Savings",
      openingBalanceMinor: 10_000,
      openingDate: "2026-01-01",
    });
    const { id } = await createTransaction(ctx, {
      type: "transfer",
      date: "2026-02-01",
      amountMinor: 40_000,
      feeMinor: 100,
      fromAccountId: bank.id,
      toAccountId: savings.id,
      fromBucket: "emergency",
      toBucket: "emergency",
    });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 59_900,
      opportunity: 200_000,
      free: 50_000,
    });
    expect(await buckets(ctx, savings.id)).toEqual({
      emergency: 40_000,
      opportunity: 0,
      free: 10_000,
    });
    await voidTransaction(ctx, id, { reason: "test" });
    expect(await buckets(ctx, bank.id)).toEqual({
      emergency: 100_000,
      opportunity: 200_000,
      free: 50_000,
    });
    expect(await buckets(ctx, savings.id)).toEqual({ emergency: 0, opportunity: 0, free: 10_000 });
  });

  it("refused where a bucket makes no sense: dedicated accounts, cards, assets", async () => {
    const { ctx, bank } = await setup();
    const salary = await categoryId(ctx, "Salary");
    const ef = await makeAccount(ctx, {
      name: "EF account",
      openingBalanceMinor: 1_000,
      countsTowardEmergencyFund: true,
      openingDate: "2026-01-01",
    });
    await expect(
      createTransaction(ctx, {
        type: "income",
        date: "2026-02-01",
        amountMinor: 500,
        toAccountId: ef.id,
        categoryId: salary,
        toBucket: "opportunity",
      }),
    ).rejects.toThrow(/is all emergency money already/);
    const card = await makeAccount(ctx, {
      name: "Visa",
      type: "credit_card",
      creditCard: { limitMinor: 100_000, statementDay: 20, dueDay: 5 },
      openingDate: "2026-01-01",
    });
    await expect(
      createTransaction(ctx, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 500,
        fromAccountId: card.id,
        categoryId: await categoryId(ctx, "Groceries"),
        fromBucket: "emergency",
      }),
    ).rejects.toThrow(/cannot hold emergency money/);
    const fund = await makeHolding(ctx, { openingDate: "2026-01-01" });
    const err = (await createTransaction(ctx, {
      type: "transfer",
      date: "2026-02-01",
      amountMinor: 500,
      fromAccountId: bank.id,
      toHoldingId: fund.id,
      toBucket: "emergency",
    }).catch((e: unknown) => e)) as AppError;
    expect(err.fieldErrors?.toBucket?.[0]).toBe("Buckets apply to accounts, not assets");
  });
});
