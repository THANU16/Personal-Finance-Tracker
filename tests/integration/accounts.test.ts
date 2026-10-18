import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import {
  archiveAccount,
  createAccount,
  getAccount,
  listAccounts,
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

describe("reconcileAccount", () => {
  it.each([
    ["more money than recorded", 100_000, 112_345, 12_345, "toAccountId"],
    ["less money than recorded", 100_000, 90_000, -10_000, "fromAccountId"],
  ] as const)("posts an adjustment when there is %s", async (_l, opening, real, expected, side) => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: opening });
    const res = await reconcileAccount(ctx, bank.id, {
      realBalanceMinor: real,
      date: "2026-02-01",
    });
    expect(res.adjustmentMinor).toBe(expected);
    expect(res.account.balanceMinor).toBe(real);
    const adj = await TransactionModel.findOne({
      userId: new Types.ObjectId(ctx.userId),
      type: "adjustment",
    }).lean<TransactionDoc>();
    expect(adj?.amountMinor).toBe(Math.abs(expected));
    expect(String(adj?.[side])).toBe(bank.id);
    expect(adj?.source.kind).toBe("reconcile");
    expect(String(adj?.categoryId)).toBe(await categoryId(ctx, "Balance adjustment"));
  });

  it("reconciles a card (liability) and does nothing when balances match", async () => {
    const ctx = await makeUser();
    const card = await makeAccount(ctx, {
      type: "credit_card",
      openingBalanceMinor: -50_000,
      creditCard: { limitMinor: 100_000, statementDay: 1, dueDay: 15 },
    });
    const res = await reconcileAccount(ctx, card.id, {
      realBalanceMinor: -48_000,
      date: "2026-02-01",
    });
    expect(res.account.balanceMinor).toBe(-48_000);
    const none = await reconcileAccount(ctx, card.id, {
      realBalanceMinor: -48_000,
      date: "2026-02-01",
    });
    expect(none.adjustmentMinor).toBe(0);
    expect(await TransactionModel.countDocuments({ userId: new Types.ObjectId(ctx.userId) })).toBe(
      1,
    );
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
