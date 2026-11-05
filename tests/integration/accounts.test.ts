import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import {
  archiveAccount,
  createAccount,
  getAccount,
  listAccounts,
  convertReconcileAdjustments,
  reconcileAccount,
  unarchiveAccount,
  updateAccount,
} from "@/modules/accounts/service";
import { AppError } from "@/server/errors";
import { balanceOf, categoryId, makeAccount, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("createAccount", () => {
  it("creates a bank account with the opening balance as its balance", async () => {
    const ctx = await makeUser();
    const a = await createAccount(ctx, {
      name: "  Sampath Savings ",
      type: "bank",
      currency: "LKR",
      institution: "Sampath Bank",
      openingBalanceMinor: 25_000_000,
      openingDate: "2026-01-01",
    });
    expect(a).toMatchObject({
      name: "Sampath Savings",
      balanceMinor: 25_000_000,
      openingDate: "2026-01-01",
      includeInNetWorth: true,
      countsTowardEmergencyFund: false,
      archived: false,
      card: null,
    });
  });

  it("requires card details for credit cards and computes outstanding/utilisation", async () => {
    const ctx = await makeUser();
    const err = await errorOf(
      createAccount(ctx, {
        name: "Visa",
        type: "credit_card",
        currency: "LKR",
        openingBalanceMinor: 0,
        openingDate: "2026-01-01",
      }),
    );
    expect(err.fieldErrors).toHaveProperty("creditCard");
    const card = await createAccount(ctx, {
      name: "Visa",
      type: "credit_card",
      currency: "LKR",
      openingBalanceMinor: -2_500_000,
      openingDate: "2026-01-01",
      creditCard: { limitMinor: 10_000_000, statementDay: 20, dueDay: 5 },
    });
    expect(card.card).toMatchObject({ outstandingMinor: 2_500_000, utilisationBp: 2_500 });
    expect(card.card?.nextDueDate).toMatch(/^\d{4}-\d{2}-05$/);
  });

  it("rejects card details on other types and invalid input", async () => {
    const ctx = await makeUser();
    const err = await errorOf(
      createAccount(ctx, {
        name: "Bank",
        type: "bank",
        currency: "LKR",
        openingBalanceMinor: 0,
        openingDate: "2026-01-01",
        creditCard: { limitMinor: 1, statementDay: 1, dueDay: 1 },
      }),
    );
    expect(err.code).toBe("VALIDATION");
    const bad = await errorOf(
      createAccount(ctx, {
        name: "",
        type: "bank",
        currency: "lkr",
        openingBalanceMinor: 1.5,
        openingDate: "2026-02-30",
      }),
    );
    expect(Object.keys(bad.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(["name", "currency", "openingBalanceMinor", "openingDate"]),
    );
  });

  it("keeps a counterparty only for receivables and payables", async () => {
    const ctx = await makeUser();
    const lent = await makeAccount(ctx, {
      type: "receivable",
      counterparty: "Kamal",
      openingBalanceMinor: 5_000_000,
    });
    const bank = await makeAccount(ctx, { type: "bank", counterparty: "Ignored" });
    expect(lent.counterparty).toBe("Kamal");
    expect(bank.counterparty).toBeNull();
  });
});

describe("updateAccount", () => {
  it("recomputes the balance when the opening balance changes", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    await post(ctx, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 50_000,
      toAccountId: bank.id,
      categoryId: await categoryId(ctx, "Salary"),
    });
    const updated = await updateAccount(ctx, bank.id, {
      openingBalanceMinor: 200_000,
      name: "Renamed",
    });
    expect(updated.balanceMinor).toBe(250_000);
    expect(updated.name).toBe("Renamed");
  });

  it("blocks a currency change once transactions exist, and an opening date after them", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    expect((await updateAccount(ctx, bank.id, { currency: "USD" })).currency).toBe("USD");
    await updateAccount(ctx, bank.id, { currency: "LKR" });
    await post(ctx, {
      type: "income",
      date: "2026-02-01",
      amountMinor: 1,
      toAccountId: bank.id,
      categoryId: await categoryId(ctx, "Salary"),
    });
    expect((await errorOf(updateAccount(ctx, bank.id, { currency: "USD" }))).code).toBe("CONFLICT");
    expect(
      (await errorOf(updateAccount(ctx, bank.id, { openingDate: "2026-03-01" }))).fieldErrors,
    ).toHaveProperty("openingDate");
  });
});

describe("reconcileAccount (docs/04 §1)", () => {
  const txnsOf = (ctx: { userId: string }) =>
    TransactionModel.find({ userId: new Types.ObjectId(ctx.userId) })
      .sort({ createdAt: 1 })
      .lean<TransactionDoc[]>();

  it.each([
    ["more money than recorded", 100_000, 112_345, 12_345, "income", "toAccountId", "Interest"],
    ["less money than recorded", 100_000, 90_000, -10_000, "expense", "fromAccountId", "Bank fees"],
  ] as const)(
    "by default posts %s as %s in the default category",
    async (_l, opening, real, expected, type, side, category) => {
      const ctx = await makeUser();
      const bank = await makeAccount(ctx, { openingBalanceMinor: opening });
      const res = await reconcileAccount(ctx, bank.id, {
        realBalanceMinor: real,
        date: "2026-02-01",
      });
      expect(res.adjustmentMinor).toBe(expected);
      expect(res.account.balanceMinor).toBe(real);
      const [t] = await txnsOf(ctx);
      expect(t).toMatchObject({
        type,
        amountMinor: Math.abs(expected),
        description: "Reconciliation",
        source: { kind: "reconcile" },
      });
      expect(String(t?.[side])).toBe(bank.id);
      expect(String(t?.categoryId)).toBe(await categoryId(ctx, category, type));
    },
  );

  it("a balance adjustment stays out of cashflow; a chosen category is used", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    await reconcileAccount(ctx, bank.id, {
      realBalanceMinor: 95_000,
      date: "2026-02-01",
      recordAs: "adjustment",
    });
    const groceries = await categoryId(ctx, "Groceries");
    await reconcileAccount(ctx, bank.id, {
      realBalanceMinor: 94_000,
      date: "2026-02-02",
      recordAs: "expense",
      categoryId: groceries,
    });
    const [adj, exp] = await txnsOf(ctx);
    expect(adj).toMatchObject({ type: "adjustment", amountMinor: 5_000 });
    expect(String(adj?.categoryId)).toBe(await categoryId(ctx, "Balance adjustment"));
    expect(exp).toMatchObject({ type: "expense", amountMinor: 1_000 });
    expect(String(exp?.categoryId)).toBe(groceries);
    expect(await balanceOf(ctx, bank.id)).toBe(94_000);
  });

  it("rejects income for a lower balance (and expense for a higher one)", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000 });
    const err = await reconcileAccount(ctx, bank.id, {
      realBalanceMinor: 90_000,
      date: "2026-02-01",
      recordAs: "income",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).fieldErrors).toHaveProperty("recordAs");
    await expect(
      reconcileAccount(ctx, bank.id, {
        realBalanceMinor: 110_000,
        date: "2026-02-01",
        recordAs: "expense",
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await balanceOf(ctx, bank.id)).toBe(100_000);
  });

  it("reconciles a card (liability) and does nothing when balances match", async () => {
    const ctx = await makeUser();
    const card = await makeAccount(ctx, {
      type: "credit_card",
      openingBalanceMinor: -50_000,
      creditCard: { limitMinor: 100_000, statementDay: 1, dueDay: 15 },
    });
    // Owes more than recorded: a charge on the card (expense from the card).
    const res = await reconcileAccount(ctx, card.id, {
      realBalanceMinor: -52_000,
      date: "2026-02-01",
    });
    expect(res.account.balanceMinor).toBe(-52_000);
    expect((await txnsOf(ctx))[0]).toMatchObject({ type: "expense", amountMinor: 2_000 });
    const none = await reconcileAccount(ctx, card.id, {
      realBalanceMinor: -52_000,
      date: "2026-02-01",
    });
    expect(none.adjustmentMinor).toBe(0);
    expect(await TransactionModel.countDocuments({ userId: new Types.ObjectId(ctx.userId) })).toBe(
      1,
    );
  });
});

describe("convertReconcileAdjustments (owner request, docs/04 §1)", () => {
  it("dry run lists; apply voids + reposts as expense / income; balances unchanged", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank BOC", openingBalanceMinor: 100_000 });
    const hnb = await makeAccount(ctx, { name: "Bank HNB", openingBalanceMinor: 100_000 });
    const old = await makeAccount(ctx, { name: "Old", openingBalanceMinor: 100_000 });
    await reconcileAccount(ctx, bank.id, {
      realBalanceMinor: 99_429,
      date: "2026-11-05",
      recordAs: "adjustment",
    });
    await reconcileAccount(ctx, hnb.id, {
      realBalanceMinor: 100_674,
      date: "2026-11-05",
      recordAs: "adjustment",
    });
    await reconcileAccount(ctx, old.id, {
      realBalanceMinor: 100_100,
      date: "2026-11-05",
      recordAs: "adjustment",
    });
    await archiveAccount(ctx, old.id, { force: true });

    const dry = await convertReconcileAdjustments(ctx, { apply: false });
    expect(
      dry.map((r) => [r.accountName, r.amountMinor, r.recordAs, r.categoryName, r.skipped]),
    ).toEqual([
      ["Bank BOC", -571, "expense", "Bank fees", null],
      ["Bank HNB", 674, "income", "Interest", null],
      ["Old", 100, "income", "Interest", "account is archived"],
    ]);
    // A dry run writes nothing.
    expect(
      await TransactionModel.countDocuments({
        userId: new Types.ObjectId(ctx.userId),
        type: "adjustment",
        status: "posted",
      }),
    ).toBe(3);

    await convertReconcileAdjustments(ctx, { apply: true });
    const uid = new Types.ObjectId(ctx.userId);
    const posted = await TransactionModel.find({ userId: uid, status: "posted" })
      .sort({ createdAt: 1 })
      .lean<TransactionDoc[]>();
    expect(posted.map((t) => [t.type, t.amountMinor, t.source.kind])).toEqual([
      ["adjustment", 100, "reconcile"], // archived account: left as it was
      ["expense", 571, "reconcile"],
      ["income", 674, "reconcile"],
    ]);
    expect(await TransactionModel.countDocuments({ userId: uid, status: "void" })).toBe(2);
    expect(await balanceOf(ctx, bank.id)).toBe(99_429);
    expect(await balanceOf(ctx, hnb.id)).toBe(100_674);
    // Nothing left to convert (the archived one stays listed as skipped).
    const again = await convertReconcileAdjustments(ctx, { apply: false });
    expect(again.filter((r) => !r.skipped)).toEqual([]);
  });
});

describe("archive", () => {
  it("needs confirmation to archive an account with a balance", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Old account", openingBalanceMinor: 50_000 });
    const err = await errorOf(archiveAccount(ctx, bank.id, {}));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toContain("LKR 500.00");
    expect((await archiveAccount(ctx, bank.id, { force: true })).archived).toBe(true);
    expect((await listAccounts(ctx)).map((a) => a.id)).not.toContain(bank.id);
    expect((await listAccounts(ctx, { includeArchived: true })).map((a) => a.id)).toContain(
      bank.id,
    );
    expect((await unarchiveAccount(ctx, bank.id)).archived).toBe(false);
  });

  it("archives a zero-balance account without confirmation", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx);
    expect((await archiveAccount(ctx, bank.id, {})).archived).toBe(true);
    expect(await balanceOf(ctx, bank.id)).toBe(0);
  });

  it("hides other users' accounts", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const a = await makeAccount(alice);
    expect((await errorOf(getAccount(bob, a.id))).code).toBe("NOT_FOUND");
    expect((await errorOf(archiveAccount(bob, a.id, {}))).code).toBe("NOT_FOUND");
    expect(await listAccounts(bob)).toEqual([]);
  });
});
