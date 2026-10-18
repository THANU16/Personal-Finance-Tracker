import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { cashflowOf } from "@/domain/ledger";
import { AccountModel } from "@/modules/accounts/model";
import { archiveAccount } from "@/modules/accounts/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { updateTransaction, voidTransaction } from "@/modules/transactions/service";
import { AuditLogModel } from "@/server/audit/model";
import { AppError } from "@/server/errors";
import { recomputeAccount } from "@/server/ledger/recompute";
import { toLedgerTxn } from "@/server/ledger/to-ledger-txn";
import type { Ctx } from "@/server/ctx";
import { balanceOf, categoryId, makeAccount, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

async function postedTxns(ctx: Ctx, currency = "LKR") {
  const docs = await TransactionModel.find({
    userId: new Types.ObjectId(ctx.userId),
    status: "posted",
    currency,
  }).lean<TransactionDoc[]>();
  return docs.map(toLedgerTxn);
}

async function expectAppError(p: Promise<unknown>, code: AppError["code"], field?: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (field) expect(Object.keys((err as AppError).fieldErrors ?? {})).toContain(field);
}

describe("hand-calculated scenario of 20 transactions", () => {
  it("matches every balance and the month's cashflow", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, {
      name: "Sampath Savings",
      openingBalanceMinor: 50_000_000,
    });
    const cash = await makeAccount(ctx, {
      name: "Wallet cash",
      type: "cash",
      openingBalanceMinor: 2_000_000,
    });
    const card = await makeAccount(ctx, {
      name: "HNB Visa",
      type: "credit_card",
      openingBalanceMinor: 0,
      creditCard: { limitMinor: 30_000_000, statementDay: 20, dueDay: 5 },
    });
    const usd = await makeAccount(ctx, {
      name: "USD wallet",
      type: "wallet",
      currency: "USD",
      openingBalanceMinor: 10_000,
    });

    const cat = {
      salary: await categoryId(ctx, "Salary"),
      bonus: await categoryId(ctx, "Bonus"),
      interest: await categoryId(ctx, "Interest"),
      other: await categoryId(ctx, "Other income"),
      groceries: await categoryId(ctx, "Groceries"),
      fuel: await categoryId(ctx, "Fuel"),
      restaurants: await categoryId(ctx, "Restaurants"),
      rent: await categoryId(ctx, "Rent"),
      utilities: await categoryId(ctx, "Utilities"),
      health: await categoryId(ctx, "Health"),
      shopping: await categoryId(ctx, "Shopping"),
      entertainment: await categoryId(ctx, "Entertainment"),
      taxi: await categoryId(ctx, "Taxi & ride"),
      education: await categoryId(ctx, "Education"),
      personal: await categoryId(ctx, "Personal care"),
    };
    const d = (day: number) => `2026-01-${String(day).padStart(2, "0")}`;

    /*  1 */ await post(ctx, {
      type: "income",
      date: d(1),
      amountMinor: 35_000_000,
      toAccountId: bank.id,
      categoryId: cat.salary,
    });
    /*  2 */ await post(ctx, {
      type: "expense",
      date: d(2),
      amountMinor: 1_250_000,
      fromAccountId: card.id,
      categoryId: cat.groceries,
    });
    /*  3 */ await post(ctx, {
      type: "expense",
      date: d(3),
      amountMinor: 800_000,
      fromAccountId: card.id,
      categoryId: cat.fuel,
    });
    /*  4 */ await post(ctx, {
      type: "expense",
      date: d(3),
      amountMinor: 425_050,
      fromAccountId: cash.id,
      categoryId: cat.restaurants,
    });
    /*  5 */ await post(ctx, {
      type: "transfer",
      date: d(4),
      amountMinor: 1_500_000,
      fromAccountId: bank.id,
      toAccountId: cash.id,
    });
    /*  6 */ await post(ctx, {
      type: "expense",
      date: d(5),
      amountMinor: 8_500_000,
      fromAccountId: bank.id,
      categoryId: cat.rent,
    });
    /*  7 */ await post(ctx, {
      type: "expense",
      date: d(6),
      amountMinor: 999_999,
      fromAccountId: bank.id,
      splits: [
        { categoryId: cat.utilities, amountMinor: 600_000 },
        { categoryId: cat.health, amountMinor: 399_999 },
      ],
    });
    /*  8 */ await post(ctx, {
      type: "transfer",
      date: d(7),
      amountMinor: 2_075_000,
      fromAccountId: bank.id,
      toAccountId: card.id,
    });
    /*  9 */ await post(ctx, {
      type: "income",
      date: d(10),
      amountMinor: 5_000_000,
      toAccountId: bank.id,
      categoryId: cat.bonus,
    });
    /* 10 */ const shopping = await post(ctx, {
      type: "expense",
      date: d(11),
      amountMinor: 1_530_000,
      fromAccountId: card.id,
      categoryId: cat.shopping,
    });
    /* 11 */ await post(ctx, {
      type: "transfer",
      date: d(12),
      amountMinor: 3_000_000,
      fromAccountId: bank.id,
      toAccountId: usd.id,
      toAmountMinor: 10_000,
    });
    /* 12 */ await post(ctx, {
      type: "expense",
      date: d(13),
      amountMinor: 2_550,
      fromAccountId: usd.id,
      categoryId: cat.entertainment,
    });
    /* 13 */ await post(ctx, {
      type: "income",
      date: d(15),
      amountMinor: 123_456,
      toAccountId: bank.id,
      categoryId: cat.interest,
    });
    /* 14 */ await post(ctx, {
      type: "expense",
      date: d(16),
      amountMinor: 65_000,
      fromAccountId: cash.id,
      categoryId: cat.taxi,
    });
    /* 15 */ await post(ctx, {
      type: "expense",
      date: d(17),
      amountMinor: 320_075,
      fromAccountId: cash.id,
      categoryId: cat.groceries,
    });
    /* 16 */ const tuition = await post(ctx, {
      type: "expense",
      date: d(18),
      amountMinor: 4_000_000,
      fromAccountId: bank.id,
      categoryId: cat.education,
    });
    await voidTransaction(ctx, tuition, { reason: "Entered twice" });
    /* 17 */ await updateTransaction(ctx, shopping, {
      type: "expense",
      date: d(11),
      amountMinor: 1_330_000,
      fromAccountId: card.id,
      categoryId: cat.shopping,
    });
    /* 18 */ await post(ctx, {
      type: "transfer",
      date: d(20),
      amountMinor: 500_000,
      fromAccountId: cash.id,
      toAccountId: bank.id,
    });
    /* 19 */ await post(ctx, {
      type: "income",
      date: d(22),
      amountMinor: 250_000,
      toAccountId: cash.id,
      categoryId: cat.other,
    });
    /* 20 */ await post(ctx, {
      type: "expense",
      date: d(25),
      amountMinor: 180_000,
      fromAccountId: card.id,
      categoryId: cat.personal,
    });

    // Hand-calculated (minor units):
    // Bank 50,000,000 +35,000,000 −1,500,000 −8,500,000 −999,999 −2,075,000 +5,000,000 −3,000,000 +123,456 +500,000
    expect(await balanceOf(ctx, bank.id)).toBe(74_548_457);
    // Cash 2,000,000 −425,050 +1,500,000 −65,000 −320,075 −500,000 +250,000
    expect(await balanceOf(ctx, cash.id)).toBe(2_439_875);
    // Card 0 −1,250,000 −800,000 +2,075,000 −1,330,000 (edited from 1,530,000) −180,000
    expect(await balanceOf(ctx, card.id)).toBe(-1_485_000);
    // USD 10,000 +10,000 −2,550
    expect(await balanceOf(ctx, usd.id)).toBe(17_450);

    const cf = cashflowOf(await postedTxns(ctx));
    expect(cf.incomeMinor).toBe(40_373_456); // 35,000,000 + 5,000,000 + 123,456 + 250,000
    expect(cf.expenseMinor).toBe(13_870_124); // card spend counted once, transfers/void excluded
    expect(cf.expenseByCategory.get(cat.groceries)).toBe(1_570_075);
    expect(cf.expenseByCategory.get(cat.health)).toBe(399_999);

    // 20 documents: entries 1–16, the edit's replacement (17), entries 18–20; 2 are void
    // (tuition, original shopping).
    const all = await TransactionModel.find({ userId: new Types.ObjectId(ctx.userId) }).lean<
      TransactionDoc[]
    >();
    expect(all).toHaveLength(20);
    expect(all.filter((t) => t.status === "void")).toHaveLength(2);
    const original = all.find((t) => String(t._id) === shopping)!;
    expect(original.replacedById).not.toBeNull();
    expect(original.voidReason).toBe("Edited");

    // Recompute from the ledger reproduces every cache, twice in a row.
    for (const account of [bank, cash, card, usd]) {
      const before = await balanceOf(ctx, account.id);
      const uid = new Types.ObjectId(ctx.userId);
      await recomputeAccount(uid, new Types.ObjectId(account.id), null);
      await recomputeAccount(uid, new Types.ObjectId(account.id), null);
      expect(await balanceOf(ctx, account.id)).toBe(before);
    }
  });
});

describe("ledger rules", () => {
  it("card spend + bill payment doesn't double count", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 10_000_000 });
    const card = await makeAccount(ctx, {
      type: "credit_card",
      creditCard: { limitMinor: 5_000_000, statementDay: 25, dueDay: 10 },
    });
    const groceries = await categoryId(ctx, "Groceries");
    await post(ctx, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 1_200_000,
      fromAccountId: card.id,
      categoryId: groceries,
    });
    await post(ctx, {
      type: "transfer",
      date: "2026-02-10",
      amountMinor: 1_200_000,
      fromAccountId: bank.id,
      toAccountId: card.id,
    });

    expect(await balanceOf(ctx, card.id)).toBe(0);
    expect(await balanceOf(ctx, bank.id)).toBe(8_800_000);
    const cf = cashflowOf(await postedTxns(ctx));
    expect(cf.expenseMinor).toBe(1_200_000);
  });

  it("void restores the balance and recompute agrees", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 500_000 });
    const id = await post(ctx, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 123_456,
      fromAccountId: bank.id,
      categoryId: await categoryId(ctx, "Shopping"),
    });
    expect(await balanceOf(ctx, bank.id)).toBe(376_544);
    await voidTransaction(ctx, id, { reason: "Mistake" });
    expect(await balanceOf(ctx, bank.id)).toBe(500_000);
    await expectAppError(voidTransaction(ctx, id, { reason: "Again" }), "CONFLICT");
    const doc = await TransactionModel.findOne({
      _id: id,
      userId: new Types.ObjectId(ctx.userId),
    }).lean();
    expect(doc?.status).toBe("void");
    expect(doc?.voidedAt).toBeInstanceOf(Date);
  });

  it("transfers are excluded from cashflow", async () => {
    const ctx = await makeUser();
    const a = await makeAccount(ctx, { openingBalanceMinor: 1_000_000 });
    const b = await makeAccount(ctx);
    await post(ctx, {
      type: "transfer",
      date: "2026-03-01",
      amountMinor: 400_000,
      fromAccountId: a.id,
      toAccountId: b.id,
    });
    const cf = cashflowOf(await postedTxns(ctx));
    expect(cf.incomeMinor).toBe(0);
    expect(cf.expenseMinor).toBe(0);
    expect(await balanceOf(ctx, a.id)).toBe(600_000);
    expect(await balanceOf(ctx, b.id)).toBe(400_000);
  });

  it("recompute is idempotent and repairs a corrupted cache", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    await post(ctx, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 50_000,
      toAccountId: bank.id,
      categoryId: await categoryId(ctx, "Salary"),
    });
    const uid = new Types.ObjectId(ctx.userId);
    const aid = new Types.ObjectId(bank.id);
    await AccountModel.updateOne({ _id: aid, userId: uid }, { $set: { balanceMinor: 999 } });
    const first = await recomputeAccount(uid, aid, null, { audit: true });
    const second = await recomputeAccount(uid, aid, null, { audit: true });
    expect(first).toEqual({ beforeMinor: 999, afterMinor: 150_000 });
    expect(second).toEqual({ beforeMinor: 150_000, afterMinor: 150_000 });
    expect(await AuditLogModel.countDocuments({ userId: uid, action: "recompute" })).toBe(1);
  });

  it("cross-currency transfers need the received amount and store the implied rate", async () => {
    const ctx = await makeUser();
    const lkr = await makeAccount(ctx, { openingBalanceMinor: 10_000_000 });
    const usd = await makeAccount(ctx, { currency: "USD", type: "wallet" });
    await expectAppError(
      post(ctx, {
        type: "transfer",
        date: "2026-02-01",
        amountMinor: 3_000_000,
        fromAccountId: lkr.id,
        toAccountId: usd.id,
      }),
      "VALIDATION",
      "toAmountMinor",
    );
    const id = await post(ctx, {
      type: "transfer",
      date: "2026-02-01",
      amountMinor: 3_000_000,
      fromAccountId: lkr.id,
      toAccountId: usd.id,
      toAmountMinor: 10_000,
    });
    const doc = await TransactionModel.findOne({
      _id: id,
      userId: new Types.ObjectId(ctx.userId),
    }).lean<TransactionDoc>();
    expect(doc?.currency).toBe("LKR");
    expect(doc?.fxRate).toBeCloseTo(100 / 30_000, 10);
    expect(await balanceOf(ctx, usd.id)).toBe(10_000);

    // Same currency: any toAmountMinor is ignored
    const other = await makeAccount(ctx);
    const same = await post(ctx, {
      type: "transfer",
      date: "2026-02-02",
      amountMinor: 500,
      fromAccountId: lkr.id,
      toAccountId: other.id,
      toAmountMinor: 1,
    });
    const sameDoc = await TransactionModel.findOne({
      _id: same,
      userId: new Types.ObjectId(ctx.userId),
    }).lean<TransactionDoc>();
    expect(sameDoc?.toAmountMinor).toBeNull();
    expect(await balanceOf(ctx, other.id)).toBe(500);
  });

  it("edit is atomic: a failing replacement leaves the original posted", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    const id = await post(ctx, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 10_000,
      fromAccountId: bank.id,
      categoryId: await categoryId(ctx, "Shopping"),
    });
    // Salary is an income category → posting the replacement fails after the void
    await expectAppError(
      updateTransaction(ctx, id, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 20_000,
        fromAccountId: bank.id,
        categoryId: await categoryId(ctx, "Salary"),
      }),
      "VALIDATION",
    );
    const doc = await TransactionModel.findOne({
      _id: id,
      userId: new Types.ObjectId(ctx.userId),
    }).lean<TransactionDoc>();
    expect(doc?.status).toBe("posted");
    expect(await TransactionModel.countDocuments({ userId: new Types.ObjectId(ctx.userId) })).toBe(
      1,
    );
    expect(await balanceOf(ctx, bank.id)).toBe(90_000);
  });

  it("validates splits and category kinds", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    const food = await categoryId(ctx, "Groceries");
    const rent = await categoryId(ctx, "Rent");
    await expectAppError(
      post(ctx, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 1_000,
        fromAccountId: bank.id,
        splits: [
          { categoryId: food, amountMinor: 600 },
          { categoryId: rent, amountMinor: 399 },
        ],
      }),
      "VALIDATION",
      "splits",
    );
    await expectAppError(
      post(ctx, {
        type: "income",
        date: "2026-02-01",
        amountMinor: 1_000,
        toAccountId: bank.id,
        categoryId: food,
      }),
      "VALIDATION",
    );
    await expectAppError(
      post(ctx, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 1_000,
        fromAccountId: bank.id,
      }),
      "VALIDATION",
      "categoryId",
    );
    expect(await balanceOf(ctx, bank.id)).toBe(100_000);
  });

  it("rejects archived accounts, dates before opening and the same account twice", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 0 });
    const other = await makeAccount(ctx);
    const salary = await categoryId(ctx, "Salary");
    await expectAppError(
      post(ctx, {
        type: "income",
        date: "2025-12-31",
        amountMinor: 1,
        toAccountId: bank.id,
        categoryId: salary,
      }),
      "VALIDATION",
      "date",
    );
    await expectAppError(
      post(ctx, {
        type: "transfer",
        date: "2026-02-01",
        amountMinor: 1,
        fromAccountId: bank.id,
        toAccountId: bank.id,
      }),
      "VALIDATION",
      "toAccountId",
    );
    await archiveAccount(ctx, other.id, {});
    await expectAppError(
      post(ctx, {
        type: "transfer",
        date: "2026-02-01",
        amountMinor: 1,
        fromAccountId: bank.id,
        toAccountId: other.id,
      }),
      "VALIDATION",
      "toAccountId",
    );
  });

  it("isolates users: another user's accounts and transactions are invisible", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceBank = await makeAccount(alice, { openingBalanceMinor: 1_000 });
    const bobBank = await makeAccount(bob, { openingBalanceMinor: 1_000 });
    const aliceTxn = await post(alice, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 500,
      toAccountId: aliceBank.id,
      categoryId: await categoryId(alice, "Salary"),
    });
    await expectAppError(
      post(bob, {
        type: "income",
        date: "2026-02-01",
        amountMinor: 500,
        toAccountId: aliceBank.id,
        categoryId: await categoryId(bob, "Salary"),
      }),
      "VALIDATION",
      "toAccountId",
    );
    await expectAppError(
      post(bob, {
        type: "income",
        date: "2026-02-01",
        amountMinor: 500,
        toAccountId: bobBank.id,
        categoryId: await categoryId(alice, "Salary"),
      }),
      "NOT_FOUND",
    );
    await expectAppError(voidTransaction(bob, aliceTxn, { reason: "x" }), "NOT_FOUND");
    expect(await balanceOf(alice, aliceBank.id)).toBe(1_500);
    expect(await balanceOf(bob, bobBank.id)).toBe(1_000);
  });

  it("owner-managed transactions cannot be voided or edited directly", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    const [doc] = await TransactionModel.create([
      {
        userId: new Types.ObjectId(ctx.userId),
        type: "expense",
        date: new Date("2026-02-01T00:00:00Z"),
        amountMinor: 1_000,
        currency: "LKR",
        fromAccountId: new Types.ObjectId(bank.id),
        categoryId: new Types.ObjectId(await categoryId(ctx, "Shopping")),
        source: { kind: "sip_execution", refId: new Types.ObjectId() },
      },
    ]);
    const id = String(doc!._id);
    await expectAppError(voidTransaction(ctx, id, { reason: "x" }), "FORBIDDEN");
    await expectAppError(
      updateTransaction(ctx, id, {
        type: "expense",
        date: "2026-02-01",
        amountMinor: 5,
        fromAccountId: bank.id,
        categoryId: await categoryId(ctx, "Shopping"),
      }),
      "FORBIDDEN",
    );
  });

  it("writes an audit trail for post and void", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 1_000 });
    const id = await post(ctx, {
      type: "expense",
      date: "2026-02-01",
      amountMinor: 10,
      fromAccountId: bank.id,
      categoryId: await categoryId(ctx, "Shopping"),
    });
    await voidTransaction(ctx, id, { reason: "Test" });
    const actions = await AuditLogModel.find({
      userId: new Types.ObjectId(ctx.userId),
      entity: "transaction",
    })
      .sort({ at: 1 })
      .lean();
    expect(actions.map((a) => a.action)).toEqual(["post", "void"]);
  });
});
