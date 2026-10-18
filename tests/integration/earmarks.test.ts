import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { AuditLogModel } from "@/server/audit/model";
import { EarmarkModel } from "@/modules/earmarks/model";
import {
  getAccountBuckets,
  getBuckets,
  moveBetweenBuckets,
  removeEarmark,
  setEarmark,
} from "@/modules/earmarks/service";
import { reconcileAccount, updateAccount } from "@/modules/accounts/service";
import { TransactionModel } from "@/modules/transactions/model";
import {
  createTransaction,
  updateTransaction,
  voidTransaction,
} from "@/modules/transactions/service";
import { postTransaction } from "@/server/ledger/post";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import type { Ctx } from "@/server/ctx";
import {
  at,
  balanceOf,
  categoryId,
  makeAccount,
  makeHolding,
  makeUser,
  post,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

/** docs/04 §20 example account: Commercial Bank 350,000 / emergency 100,000 / opportunity 200,000. */
async function exampleAccount(ctx: Ctx) {
  const account = await makeAccount(ctx, { name: "Commercial Bank", openingBalanceMinor: 350_000 });
  await setEarmark(ctx, {
    accountId: account.id,
    bucket: "emergency",
    mode: "fixed",
    amountMinor: 100_000,
  });
  await setEarmark(ctx, {
    accountId: account.id,
    bucket: "opportunity",
    mode: "fixed",
    amountMinor: 200_000,
  });
  return account;
}

async function spend(ctx: Ctx, accountId: string, amountMinor: number, flags: object = {}) {
  return createTransaction(ctx, {
    type: "expense",
    date: "2026-02-01",
    amountMinor,
    fromAccountId: accountId,
    categoryId: await categoryId(ctx, "Groceries"),
    ...flags,
  });
}

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected the call to be rejected");
}

describe("free cash and the dip guard (docs/04 §20)", () => {
  it("worked example: free 50,000; a 20,000 spend needs no confirmation", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      emergencyMinor: 100_000,
      opportunityMinor: 200_000,
      freeMinor: 50_000,
      overEarmarked: false,
    });
    await spend(ctx, account.id, 20_000);
    expect((await getAccountBuckets(ctx, account.id)).freeMinor).toBe(30_000);
  });

  it("spend 80,000 → NEEDS_CONFIRMATION (opportunity 30,000); confirmed → opportunity 170,000", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const err = await rejection(spend(ctx, account.id, 80_000));
    expect(err.code).toBe("NEEDS_CONFIRMATION");
    expect(err.warnings).toEqual([
      {
        code: "DIPS_INTO_OPPORTUNITY",
        amountMinor: 30_000,
        currency: "LKR",
        accountName: "Commercial Bank",
      },
    ]);
    // nothing was posted or changed
    expect(await balanceOf(ctx, account.id)).toBe(350_000);
    expect(await TransactionModel.countDocuments({ userId: ctx.userId, type: "expense" })).toBe(0);

    await spend(ctx, account.id, 80_000, { confirmOpportunity: true });
    expect(await balanceOf(ctx, account.id)).toBe(270_000);
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      emergencyMinor: 100_000,
      opportunityMinor: 170_000,
      freeMinor: 0,
    });
    expect(await AuditLogModel.countDocuments({ userId: ctx.userId, action: "earmark_dip" })).toBe(
      1,
    );
  });

  it("emergency needs its own flag; opportunity is reduced first", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const err = await rejection(spend(ctx, account.id, 300_000, { confirmOpportunity: true }));
    expect(err.code).toBe("NEEDS_CONFIRMATION");
    expect(err.warnings?.map((w) => [w.code, w.amountMinor])).toEqual([
      ["DIPS_INTO_OPPORTUNITY", 200_000],
      ["DIPS_INTO_EMERGENCY", 50_000],
    ]);
    // emergency alone is not enough either
    expect(
      (await rejection(spend(ctx, account.id, 300_000, { confirmEmergency: true }))).code,
    ).toBe("NEEDS_CONFIRMATION");

    await spend(ctx, account.id, 300_000, { confirmOpportunity: true, confirmEmergency: true });
    const b = await getAccountBuckets(ctx, account.id);
    expect(b).toMatchObject({
      balanceMinor: 50_000,
      opportunityMinor: 0,
      emergencyMinor: 50_000,
      freeMinor: 0,
    });
    // opportunity reached 0 → its earmark is gone; emergency is stored as fixed 50,000
    expect(b.earmarks.map((e) => [e.bucket, e.mode, e.amountMinor])).toEqual([
      ["emergency", "fixed", 50_000],
    ]);
  });

  it("only emergency earmarked: the dip warns about emergency only", async () => {
    const ctx = await makeUser();
    const account = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    await setEarmark(ctx, {
      accountId: account.id,
      bucket: "emergency",
      mode: "percent",
      percentBp: 9_000,
    });
    const err = await rejection(spend(ctx, account.id, 30_000));
    expect(err.warnings?.map((w) => w.code)).toEqual(["DIPS_INTO_EMERGENCY"]);
    expect(
      (await rejection(spend(ctx, account.id, 30_000, { confirmOpportunity: true }))).code,
    ).toBe("NEEDS_CONFIRMATION");
    await spend(ctx, account.id, 30_000, { confirmEmergency: true });
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      emergencyMinor: 70_000,
      freeMinor: 0,
    });
  });

  it("transfers and invest include the fee in the guarded amount", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx); // free 50,000
    const other = await makeAccount(ctx);
    const transfer = {
      type: "transfer" as const,
      date: "2026-02-01",
      amountMinor: 49_900,
      fromAccountId: account.id,
      toAccountId: other.id,
    };
    await createTransaction(ctx, { ...transfer, feeMinor: 100 }); // exactly free cash
    expect((await getAccountBuckets(ctx, account.id)).freeMinor).toBe(0);
    const err = await rejection(
      createTransaction(ctx, { ...transfer, amountMinor: 1, feeMinor: 0 }),
    );
    expect(err.warnings?.[0]).toMatchObject({ code: "DIPS_INTO_OPPORTUNITY", amountMinor: 1 });

    const holding = await makeHolding(ctx);
    const invest = await rejection(
      createTransaction(ctx, {
        type: "invest",
        date: "2026-02-01",
        amountMinor: 1_000,
        feeMinor: 50,
        fromAccountId: account.id,
        holdingId: holding.id,
      }),
    );
    expect(invest.warnings?.[0]).toMatchObject({
      code: "DIPS_INTO_OPPORTUNITY",
      amountMinor: 1_050,
    });
  });

  it("income and reconcile adjustments are never guarded", async () => {
    const ctx = await makeUser();
    const account = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    await setEarmark(ctx, {
      accountId: account.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 100_000,
    });
    await post(ctx, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 10,
      toAccountId: account.id,
      categoryId: await categoryId(ctx, "Salary"),
    });
    // Reconciling down into earmarked money posts an adjustment without asking.
    await reconcileAccount(ctx, account.id, { realBalanceMinor: 40_000, date: "2026-02-02" });
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      balanceMinor: 40_000,
      opportunityMinor: 40_000,
      overEarmarked: true,
    });
  });
});

describe("edits guard only the increase", () => {
  it("re-saving or lowering an expense beyond free cash needs no confirmation; raising it does", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx); // free 50,000
    const { id } = await spend(ctx, account.id, 50_000); // free 0
    const groceries = await categoryId(ctx, "Groceries");
    const edit = (amountMinor: number, flags: object = {}) =>
      updateTransaction(ctx, id, {
        type: "expense",
        date: "2026-02-01",
        amountMinor,
        fromAccountId: account.id,
        categoryId: groceries,
        ...flags,
      });

    const same = await edit(50_000);
    expect(await balanceOf(ctx, account.id)).toBe(300_000);
    const lower = await updateTransaction(ctx, same.id, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 40_000,
      fromAccountId: account.id,
      categoryId: groceries,
    });
    expect((await getAccountBuckets(ctx, account.id)).freeMinor).toBe(10_000);

    const raise = await rejection(
      updateTransaction(ctx, lower.id, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 55_000,
        fromAccountId: account.id,
        categoryId: groceries,
      }),
    );
    // only the 15,000 increase is checked against the 10,000 free → 5,000 from opportunity
    expect(raise.warnings?.[0]).toMatchObject({
      code: "DIPS_INTO_OPPORTUNITY",
      amountMinor: 5_000,
    });
    // the failed edit rolled back: original still posted
    expect(
      (await TransactionModel.findOne({ _id: lower.id, userId: ctx.userId }).lean())?.status,
    ).toBe("posted");
  });

  it("moving an expense to another account is guarded on the new account", async () => {
    const ctx = await makeUser();
    const guarded = await exampleAccount(ctx);
    const plain = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    const groceries = await categoryId(ctx, "Groceries");
    const { id } = await spend(ctx, plain.id, 60_000);
    const err = await rejection(
      updateTransaction(ctx, id, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 60_000,
        fromAccountId: guarded.id,
        categoryId: groceries,
      }),
    );
    expect(err.code).toBe("NEEDS_CONFIRMATION");
  });

  it("void is never guarded and does not re-inflate earmarks", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const { id } = await spend(ctx, account.id, 80_000, { confirmOpportunity: true });
    await voidTransaction(ctx, id, { reason: "Mistake" });
    expect(await balanceOf(ctx, account.id)).toBe(350_000);
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      emergencyMinor: 100_000,
      opportunityMinor: 170_000,
      freeMinor: 80_000,
    });
  });
});

describe("move between buckets", () => {
  it("changes no balance and posts no transaction; percent becomes fixed", async () => {
    const ctx = await makeUser();
    const account = await makeAccount(ctx, { openingBalanceMinor: 200_000 });
    await setEarmark(ctx, {
      accountId: account.id,
      bucket: "opportunity",
      mode: "percent",
      percentBp: 5_000,
    });
    const txnsBefore = await TransactionModel.countDocuments({ userId: ctx.userId });

    let b = await moveBetweenBuckets(ctx, {
      accountId: account.id,
      from: "free",
      to: "emergency",
      amountMinor: 30_000,
    });
    expect(b).toMatchObject({
      emergencyMinor: 30_000,
      opportunityMinor: 100_000,
      freeMinor: 70_000,
    });
    b = await moveBetweenBuckets(ctx, {
      accountId: account.id,
      from: "opportunity",
      to: "emergency",
      amountMinor: 25_000,
    });
    expect(b).toMatchObject({
      emergencyMinor: 55_000,
      opportunityMinor: 75_000,
      freeMinor: 70_000,
    });
    expect(b.earmarks.find((e) => e.bucket === "opportunity")).toMatchObject({
      mode: "fixed",
      amountMinor: 75_000,
    });
    b = await moveBetweenBuckets(ctx, {
      accountId: account.id,
      from: "emergency",
      to: "free",
      amountMinor: 55_000,
    });
    expect(b.earmarks.map((e) => e.bucket)).toEqual(["opportunity"]);

    expect(await balanceOf(ctx, account.id)).toBe(200_000);
    expect(await TransactionModel.countDocuments({ userId: ctx.userId })).toBe(txnsBefore);
  });

  it("rejects moving more than the source bucket holds", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const err = await rejection(
      moveBetweenBuckets(ctx, {
        accountId: account.id,
        from: "free",
        to: "opportunity",
        amountMinor: 50_001,
      }),
    );
    expect(err.code).toBe("VALIDATION");
    expect(err.fieldErrors?.amountMinor).toBeDefined();
  });
});

describe("saving earmarks", () => {
  it("Σ raw must fit in the balance at save time", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const err = await rejection(
      setEarmark(ctx, {
        accountId: account.id,
        bucket: "opportunity",
        mode: "fixed",
        amountMinor: 250_001,
      }),
    );
    expect(err.code).toBe("VALIDATION");
    // replacing a bucket counts the new value, not old + new
    await setEarmark(ctx, {
      accountId: account.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 250_000,
    });
    expect((await getAccountBuckets(ctx, account.id)).freeMinor).toBe(0);
  });

  it("over-earmarked after spending shows reduced effective values (opportunity first)", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const other = await makeAccount(ctx);
    // A transfer marked as reconcile is exempt from the guard, so the balance can drop under the earmarks.
    await withTransaction((session) =>
      postTransaction(
        ctx,
        {
          type: "transfer",
          date: at("2026-02-01"),
          amountMinor: 100_000,
          fromAccountId: account.id,
          toAccountId: other.id,
          source: { kind: "reconcile" },
        },
        session,
      ),
    );
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      balanceMinor: 250_000,
      emergencyMinor: 100_000,
      opportunityMinor: 150_000,
      freeMinor: 0,
      overEarmarked: true,
    });
  });

  it("remove deletes the bucket's earmark", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const b = await removeEarmark(ctx, { accountId: account.id, bucket: "opportunity" });
    expect(b).toMatchObject({ opportunityMinor: 0, freeMinor: 250_000 });
    await expect(
      removeEarmark(ctx, { accountId: account.id, bucket: "opportunity" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("dedicated accounts", () => {
  it("reject explicit earmarks", async () => {
    const ctx = await makeUser();
    const fund = await makeAccount(ctx, { type: "opportunity_fund", openingBalanceMinor: 500_000 });
    const emergency = await makeAccount(ctx, {
      countsTowardEmergencyFund: true,
      openingBalanceMinor: 300_000,
    });
    const card = await makeAccount(ctx, {
      type: "credit_card",
      creditCard: { limitMinor: 100_000, statementDay: 1, dueDay: 20 },
    });
    for (const acc of [fund, emergency, card]) {
      await expect(
        setEarmark(ctx, { accountId: acc.id, bucket: "emergency", mode: "fixed", amountMinor: 1 }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
    const empty = await makeAccount(ctx);
    await expect(
      setEarmark(ctx, { accountId: empty.id, bucket: "emergency", mode: "fixed", amountMinor: 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("any outflow warns WITHDRAWS_FROM_*; the matching flag confirms", async () => {
    const ctx = await makeUser();
    const fund = await makeAccount(ctx, {
      type: "opportunity_fund",
      name: "Opp",
      openingBalanceMinor: 500_000,
    });
    const emergency = await makeAccount(ctx, {
      countsTowardEmergencyFund: true,
      name: "EF",
      openingBalanceMinor: 300_000,
    });
    const bank = await makeAccount(ctx);
    const transfer = (fromAccountId: string, flags: object = {}) =>
      createTransaction(ctx, {
        type: "transfer",
        date: "2026-02-01",
        amountMinor: 1_000,
        fromAccountId,
        toAccountId: bank.id,
        ...flags,
      });

    expect((await rejection(transfer(fund.id))).warnings).toEqual([
      {
        code: "WITHDRAWS_FROM_OPPORTUNITY",
        amountMinor: 1_000,
        currency: "LKR",
        accountName: "Opp",
      },
    ]);
    expect((await rejection(transfer(emergency.id))).warnings?.[0]?.code).toBe(
      "WITHDRAWS_FROM_EMERGENCY",
    );
    expect((await rejection(transfer(emergency.id, { confirmOpportunity: true }))).code).toBe(
      "NEEDS_CONFIRMATION",
    );
    await transfer(fund.id, { confirmOpportunity: true });
    await transfer(emergency.id, { confirmEmergency: true });
    expect(await balanceOf(ctx, bank.id)).toBe(2_000);
  });

  it("FD maturity, reconcile and deployment sources are exempt", async () => {
    const ctx = await makeUser();
    const fund = await makeAccount(ctx, { type: "opportunity_fund", openingBalanceMinor: 500_000 });
    const bank = await makeAccount(ctx);
    for (const kind of ["opportunity_deployment", "fd_maturity", "reconcile"] as const) {
      await withTransaction((session) =>
        postTransaction(
          ctx,
          {
            type: "transfer",
            date: at("2026-02-01"),
            amountMinor: 1_000,
            fromAccountId: fund.id,
            toAccountId: bank.id,
            source: { kind },
          },
          session,
        ),
      );
    }
    expect(await balanceOf(ctx, bank.id)).toBe(3_000);
  });

  it("an account with earmarks cannot be flagged as emergency fund", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    await expect(
      updateAccount(ctx, account.id, { countsTowardEmergencyFund: true }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await removeEarmark(ctx, { accountId: account.id, bucket: "emergency" });
    await removeEarmark(ctx, { accountId: account.id, bucket: "opportunity" });
    await updateAccount(ctx, account.id, { countsTowardEmergencyFund: true });
  });
});

describe("bucket totals", () => {
  it("emergency = earmarks + flagged accounts + flagged holdings; opportunity = earmarks + funds", async () => {
    const ctx = await makeUser();
    await exampleAccount(ctx); // E 100,000 / O 200,000 / free 50,000
    await makeAccount(ctx, { type: "opportunity_fund", openingBalanceMinor: 500_000 });
    await makeAccount(ctx, { countsTowardEmergencyFund: true, openingBalanceMinor: 300_000 });
    await makeAccount(ctx, { openingBalanceMinor: 25_000 }); // plain: all free
    await makeHolding(ctx, {
      countsTowardEmergencyFund: true,
      investedMinor: 40_000,
      currentValueMinor: 40_000,
    });
    await makeAccount(ctx, { currency: "USD", openingBalanceMinor: 1_000 });
    expect(await getBuckets(ctx)).toEqual([
      { currency: "LKR", emergencyMinor: 440_000, opportunityMinor: 700_000, freeMinor: 75_000 },
      { currency: "USD", emergencyMinor: 0, opportunityMinor: 0, freeMinor: 1_000 },
    ]);
  });
});

describe("isolation and atomicity", () => {
  it("another user cannot read or change earmarks", async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const account = await exampleAccount(owner);
    await expect(getAccountBuckets(intruder, account.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      setEarmark(intruder, {
        accountId: account.id,
        bucket: "emergency",
        mode: "fixed",
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      moveBetweenBuckets(intruder, {
        accountId: account.id,
        from: "free",
        to: "emergency",
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getBuckets(intruder)).toEqual([]);
    expect(await EarmarkModel.countDocuments({ userId: new Types.ObjectId(owner.userId) })).toBe(2);
  });

  it("a failure after the earmark reduction rolls everything back", async () => {
    const ctx = await makeUser();
    const account = await exampleAccount(ctx);
    const groceries = await categoryId(ctx, "Groceries");
    await expect(
      withTransaction(async (session) => {
        await postTransaction(
          ctx,
          {
            type: "expense",
            date: at("2026-02-01"),
            amountMinor: 80_000,
            fromAccountId: account.id,
            categoryId: groceries,
            confirmOpportunity: true,
          },
          session,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await balanceOf(ctx, account.id)).toBe(350_000);
    expect(await getAccountBuckets(ctx, account.id)).toMatchObject({
      opportunityMinor: 200_000,
      freeMinor: 50_000,
    });
  });
});
