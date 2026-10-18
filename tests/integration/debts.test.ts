import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { cashflowOf } from "@/domain/ledger";
import { dueDate, emiMinor, outstandingAfter } from "@/domain/loan";
import { CategoryModel } from "@/modules/categories/model";
import { DebtModel, type DebtDoc } from "@/modules/debts/model";
import {
  createDebt,
  debtUpcoming,
  getDebt,
  listDebts,
  previewPrepayment,
  recordPayment,
  recordPrepayment,
  settleCounterparty,
  updateDebt,
} from "@/modules/debts/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { voidTransaction } from "@/modules/transactions/service";
import { AppError } from "@/server/errors";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import { toLedgerTxn } from "@/server/ledger/to-ledger-txn";
import type { Ctx } from "@/server/ctx";
import { balanceOf, makeAccount, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);
const P = 100_000_000; // 1,000,000.00 at 12% for 12 months → EMI 88,848.79
const EMI = 8_884_879;

async function debtDoc(ctx: Ctx, id: string) {
  return (await DebtModel.findOne({
    _id: new Types.ObjectId(id),
    userId: uid(ctx),
  }).lean<DebtDoc>())!;
}

async function setup(extra: Record<string, unknown> = {}) {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { name: "Sampath", openingBalanceMinor: 50_000_000 });
  const { id } = await createDebt(ctx, {
    name: "Car loan",
    kind: "bank_loan",
    lender: "NSB",
    principalMinor: P,
    annualRateBp: 1200,
    tenureMonths: 12,
    startDate: "2026-01-10",
    paymentDay: 10,
    paymentAccountId: bank.id,
    receivedIntoAccountId: bank.id,
    ...extra,
  });
  const d = await debtDoc(ctx, id);
  return { ctx, bank, id, loanId: String(d.accountId) };
}

const pay = (ctx: Ctx, id: string, fromAccountId: string, amountMinor = EMI, date = "2026-02-10") =>
  recordPayment(ctx, id, {
    date,
    amountMinor,
    fromAccountId,
    confirmOpportunity: true,
    confirmEmergency: true,
  });

describe("loans", () => {
  it("a new loan opens at 0 and the disbursement makes it −principal; the bank receives it", async () => {
    const { ctx, bank, id, loanId } = await setup();
    expect(await balanceOf(ctx, loanId)).toBe(-P);
    expect(await balanceOf(ctx, bank.id)).toBe(50_000_000 + P);
    expect(await debtDoc(ctx, id)).toMatchObject({
      emiMinor: EMI,
      outstandingMinor: P,
      nextDueDate: "2026-02-10",
      projectedPayoffDate: "2027-01-10",
      status: "active",
    });
    const detail = await getDebt(ctx, id);
    expect(detail.schedule).toHaveLength(12);
    expect(detail.schedule.reduce((s, r) => s + r.principalMinor, 0)).toBe(P);
  });

  it("a payment splits interest (an expense) from principal (not an expense) and voids cleanly", async () => {
    const { ctx, bank, id, loanId } = await setup();
    const r = await pay(ctx, id, bank.id);
    expect(r).toMatchObject({ principalMinor: 7_884_879, interestMinor: 1_000_000, warnings: [] });
    expect(await balanceOf(ctx, loanId)).toBe(-92_115_121);
    expect(await balanceOf(ctx, bank.id)).toBe(50_000_000 + P - EMI);
    expect(await debtDoc(ctx, id)).toMatchObject({
      outstandingMinor: 92_115_121,
      principalPaidMinor: 7_884_879,
      interestPaidMinor: 1_000_000,
      paymentsCount: 1,
      nextDueDate: "2026-03-10",
    });

    const txn = await TransactionModel.findOne({
      userId: uid(ctx),
      type: "debt_payment",
    }).lean<TransactionDoc>();
    const interestCat = await CategoryModel.findOne({
      userId: uid(ctx),
      name: "Loan interest",
      isSystem: true,
    }).lean();
    expect(String(txn!.categoryId)).toBe(String(interestCat!._id));
    const all = await TransactionModel.find({ userId: uid(ctx), status: "posted" }).lean<
      TransactionDoc[]
    >();
    const cf = cashflowOf(all.map(toLedgerTxn));
    expect(cf.expenseMinor).toBe(1_000_000); // interest only; the disbursement transfer is not income
    expect(cf.incomeMinor).toBe(0);

    await voidTransaction(ctx, String(txn!._id), { reason: "test" });
    expect(await balanceOf(ctx, loanId)).toBe(-P);
    expect(await debtDoc(ctx, id)).toMatchObject({
      outstandingMinor: P,
      paymentsCount: 0,
      nextDueDate: "2026-02-10",
    });
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);
  });

  it("warns when a payment is below the interest; refuses paying more than is owed", async () => {
    const { ctx, bank, id } = await setup();
    const short = await pay(ctx, id, bank.id, 600_000);
    expect(short).toMatchObject({ principalMinor: 0, interestMinor: 600_000 });
    expect(short.warnings[0]).toMatch(/less than this month's interest/);
    const err = await pay(ctx, id, bank.id, P + 2_000_000).catch((e: unknown) => e);
    expect((err as AppError).code).toBe("VALIDATION");
  });

  it("reduce-tenure prepayment shortens the plan; reduce-EMI lowers the EMI; voiding restores it", async () => {
    const { ctx, bank, id } = await setup();
    await pay(ctx, id, bank.id);
    const preview = await previewPrepayment(ctx, id, {
      amountMinor: 30_000_000,
      mode: "reduce_tenure",
    });
    expect(preview.before).toMatchObject({
      emiMinor: EMI,
      monthsLeft: 11,
      payoffDate: "2027-01-10",
    });
    expect(preview.after).toMatchObject({ emiMinor: EMI, monthsLeft: 8 });
    expect(preview.after.interestLeftMinor).toBeLessThan(preview.before.interestLeftMinor);

    await recordPrepayment(ctx, id, {
      date: "2026-02-20",
      amountMinor: 30_000_000,
      fromAccountId: bank.id,
      mode: "reduce_tenure",
      confirmOpportunity: true,
      confirmEmergency: true,
    });
    let d = await debtDoc(ctx, id);
    expect(d).toMatchObject({
      outstandingMinor: 62_115_121,
      emiMinor: EMI,
      tenureMonths: 9,
      paymentsCount: 1,
      nextDueDate: "2026-03-10",
    });
    expect(d.projectedPayoffDate).toBe(dueDate("2026-01-10", 10, 9));

    await recordPrepayment(ctx, id, {
      date: "2026-02-25",
      amountMinor: 10_000_000,
      fromAccountId: bank.id,
      mode: "reduce_emi",
      confirmOpportunity: true,
      confirmEmergency: true,
    });
    d = await debtDoc(ctx, id);
    expect(d.tenureMonths).toBe(9);
    expect(d.emiMinor).toBeLessThan(EMI);
    const lowered = d.emiMinor;

    // Voiding the reduce-EMI prepayment restores the EMI it changed.
    const last = d.prepayments.at(-1)!;
    await voidTransaction(ctx, String(last.transactionId), { reason: "test" });
    d = await debtDoc(ctx, id);
    expect(d.emiMinor).toBe(EMI);
    expect(d.emiMinor).not.toBe(lowered);
    expect(d.outstandingMinor).toBe(62_115_121);
    expect(d.prepayments.at(-1)!.reverted).toBe(true);
  });

  it("paying everything closes the loan; voiding reopens it", async () => {
    const { ctx, bank, id } = await setup();
    const r = await pay(ctx, id, bank.id, P + 1_000_000);
    expect(r.principalMinor).toBe(P);
    let d = await debtDoc(ctx, id);
    expect(d).toMatchObject({
      status: "closed",
      outstandingMinor: 0,
      nextDueDate: null,
      projectedPayoffDate: "2026-02-10",
    });
    expect(d.closedAt).not.toBeNull();
    await voidTransaction(ctx, r.transactionId, { reason: "test" });
    d = await debtDoc(ctx, id);
    expect(d).toMatchObject({ status: "active", outstandingMinor: P, closedAt: null });
  });

  it("an existing loan opens at the scheduled outstanding after the instalments already paid", async () => {
    const ctx = await makeUser();
    const { id } = await createDebt(ctx, {
      name: "Home loan",
      kind: "bank_loan",
      principalMinor: P,
      annualRateBp: 1200,
      tenureMonths: 12,
      startDate: "2025-12-10",
      paymentDay: 10,
      paidBeforeTracking: 3,
    });
    const d = await debtDoc(ctx, id);
    const outstanding = outstandingAfter(P, 1200, 12, 3);
    expect(await balanceOf(ctx, String(d.accountId))).toBe(-outstanding);
    expect(d).toMatchObject({
      outstandingMinor: outstanding,
      paymentsCount: 3,
      nextDueDate: "2026-04-10",
    });
    const detail = await getDebt(ctx, id);
    expect(detail.schedule.filter((r) => r.state === "before_tracking")).toHaveLength(3);
    expect(detail.schedule.reduce((s, r) => s + r.principalMinor, 0)).toBe(P);
    expect(detail.schedule[3]!.no).toBe(4);
  });

  it("EMIs show in upcoming (outflow from an earmarkable account) and in the overview with DTI", async () => {
    const { ctx, bank, id } = await setup();
    const items = await debtUpcoming(ctx, "2026-03-31");
    expect(items.map((i) => [i.dueDate, i.amountMinor, i.outflowMinor])).toEqual([
      ["2026-02-10", EMI, EMI],
      ["2026-03-10", EMI, EMI],
    ]);
    expect(items[0]!.accountId).toBe(bank.id);
    const o = await listDebts(ctx);
    expect(o.debts).toHaveLength(1);
    expect(o.totals).toMatchObject({ outstandingMinor: P, monthlyEmiMinor: EMI });
    expect(o.dtiBp).toBeNull(); // no income yet
    expect(o.debts[0]!.id).toBe(id);
  });
});

describe("editing a loan (everything, any time)", () => {
  const edit = (overrides: Record<string, unknown> = {}) => ({
    name: "Car loan",
    kind: "bank_loan",
    lender: "NSB",
    principalMinor: P,
    annualRateBp: 1200,
    tenureMonths: 12,
    startDate: "2026-01-10",
    paymentDay: 10,
    paidBeforeTracking: 0,
    emiMinor: null,
    paymentAccountId: null,
    ...overrides,
  });

  it("a rate change keeps past payments and rebuilds the EMI over the months left", async () => {
    const { ctx, bank, id, loanId } = await setup();
    await pay(ctx, id, bank.id);
    await updateDebt(ctx, id, edit({ annualRateBp: 1000, name: "Car loan (NSB)" }));
    const d = await debtDoc(ctx, id);
    expect(d).toMatchObject({
      annualRateBp: 1000,
      outstandingMinor: 92_115_121,
      paymentsCount: 1,
      nextDueDate: "2026-03-10",
    });
    expect(d.emiMinor).toBe(emiMinor(92_115_121, 1000, 11));
    const paid = await TransactionModel.findOne({
      userId: uid(ctx),
      type: "debt_payment",
    }).lean<TransactionDoc>();
    expect(paid).toMatchObject({ interestMinor: 1_000_000, principalMinor: 7_884_879 });
    expect(await balanceOf(ctx, loanId)).toBe(-92_115_121);
    expect((await getDebt(ctx, id)).name).toBe("Car loan (NSB)");
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);
  });

  it("a new amount re-posts the disbursement; an EMI can be set by hand", async () => {
    const { ctx, bank, id, loanId } = await setup();
    await updateDebt(ctx, id, edit({ principalMinor: 80_000_000, emiMinor: 7_200_000 }));
    expect(await balanceOf(ctx, loanId)).toBe(-80_000_000);
    expect(await balanceOf(ctx, bank.id)).toBe(50_000_000 + 80_000_000);
    expect(await debtDoc(ctx, id)).toMatchObject({
      principalMinor: 80_000_000,
      outstandingMinor: 80_000_000,
      emiMinor: 7_200_000,
    });
    const transfers = await TransactionModel.find({ userId: uid(ctx), type: "transfer" }).lean<
      TransactionDoc[]
    >();
    expect(transfers.map((t) => [t.status, t.amountMinor]).sort()).toEqual([
      ["posted", 80_000_000],
      ["void", P],
    ]);
    const err = await updateDebt(ctx, id, edit({ paidBeforeTracking: 2 })).catch((e: unknown) => e);
    expect((err as AppError).message).toMatch(/new loan/);
  });

  it("an existing loan follows a changed instalment count; a start after a payment is refused", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 50_000_000 });
    const { id } = await createDebt(ctx, {
      name: "Home loan",
      kind: "bank_loan",
      principalMinor: P,
      annualRateBp: 1200,
      tenureMonths: 12,
      startDate: "2025-12-10",
      paymentDay: 10,
      paidBeforeTracking: 3,
    });
    await updateDebt(
      ctx,
      id,
      edit({ name: "Home loan", startDate: "2025-12-10", paidBeforeTracking: 2 }),
    );
    let d = await debtDoc(ctx, id);
    expect(d).toMatchObject({
      outstandingMinor: outstandingAfter(P, 1200, 12, 2),
      paymentsCount: 2,
      nextDueDate: "2026-03-10",
    });
    await pay(ctx, id, bank.id, EMI, "2026-03-10");
    const err = await updateDebt(
      ctx,
      id,
      edit({ name: "Home loan", startDate: "2026-04-01" }),
    ).catch((e: unknown) => e);
    expect((err as AppError).message).toMatch(/before the loan.s new start/);
    d = await debtDoc(ctx, id);
    expect(d.paymentsCount).toBe(3);
  });
});

describe("receivables and payables", () => {
  it("settles a receivable into an account and a payable from one", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 10_000_000 });
    const owedToMe = await makeAccount(ctx, {
      name: "Lent to Kasun",
      type: "receivable",
      openingBalanceMinor: 2_000_000,
      counterparty: "Kasun",
    });
    const iOwe = await makeAccount(ctx, {
      name: "Owe Amma",
      type: "payable",
      openingBalanceMinor: -1_500_000,
      counterparty: "Amma",
    });

    expect((await listDebts(ctx)).counterparties.map((c) => c.name).sort()).toEqual([
      "Lent to Kasun",
      "Owe Amma",
    ]);
    await settleCounterparty(ctx, {
      accountId: owedToMe.id,
      otherAccountId: bank.id,
      amountMinor: 500_000,
      date: "2026-02-01",
    });
    expect(await balanceOf(ctx, owedToMe.id)).toBe(1_500_000);
    expect(await balanceOf(ctx, bank.id)).toBe(10_500_000);

    await settleCounterparty(ctx, {
      accountId: iOwe.id,
      otherAccountId: bank.id,
      amountMinor: 1_500_000,
      date: "2026-02-01",
    });
    expect(await balanceOf(ctx, iOwe.id)).toBe(0);
    expect(await balanceOf(ctx, bank.id)).toBe(9_000_000);
    expect((await listDebts(ctx)).counterparties.map((c) => c.name)).toEqual(["Lent to Kasun"]);

    const err = await settleCounterparty(ctx, {
      accountId: owedToMe.id,
      otherAccountId: bank.id,
      amountMinor: 9_999_999,
      date: "2026-02-01",
    }).catch((e: unknown) => e);
    expect((err as AppError).code).toBe("VALIDATION");
  });
});
