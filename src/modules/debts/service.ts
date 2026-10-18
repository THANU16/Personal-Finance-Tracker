import "server-only";
import { Types, type ClientSession } from "mongoose";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { isEarmarkable } from "@/domain/earmarks";
import {
  amortisation,
  applyPrepayment,
  dtiBp,
  dueDate,
  emiMinor as calcEmi,
  monthlyRate,
  outstandingAfter,
  splitPayment,
} from "@/domain/loan";
import { roundHalfAwayFromZero } from "@/domain/money";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { DebtModel, type DebtDoc } from "@/modules/debts/model";
import {
  createDebtSchema,
  paymentSchema,
  prepaymentPreviewSchema,
  prepaymentSchema,
  settleSchema,
  updateDebtSchema,
  type CounterpartyDTO,
  type DebtDetailDTO,
  type DebtPaymentDTO,
  type DebtsOverviewDTO,
  type DebtSummaryDTO,
  type PrepaymentPreviewDTO,
  type ScheduleRowDTO,
} from "@/modules/debts/schemas";
import { loadToBase } from "@/modules/fx/service";
import {
  TransactionModel,
  type SourceKind,
  type TransactionDoc,
} from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { recomputeDebt } from "@/server/ledger/debt";
import { postTransaction } from "@/server/ledger/post";
import { voidTransaction } from "@/server/ledger/void";
import { recomputeAccount } from "@/server/ledger/recompute";

// docs/04 §10 — loans: the loan is an account of type `loan` (negative balance); payments are
// `debt_payment` transactions (interest = expense, principal reduces the loan); the debt keeps the
// terms and caches (recomputeDebt). Receivables/payables are settled with transfers.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);

async function loadDebt(
  ctx: Ctx,
  id: string,
  session: ClientSession | null = null,
): Promise<DebtDoc> {
  const d = await DebtModel.findOne({ _id: toObjectId(id, "Loan"), userId: uid(ctx) })
    .session(session)
    .lean<DebtDoc>();
  if (!d) throw new AppError("NOT_FOUND", "Loan not found");
  return d;
}

async function loadAccountOf(ctx: Ctx, id: string, field: string, session: ClientSession | null) {
  const a = await AccountModel.findOne({ _id: toObjectId(id, "Account"), userId: uid(ctx) })
    .session(session)
    .lean<AccountDoc>();
  if (!a) throw new AppError("VALIDATION", "Account not found", { [field]: ["Account not found"] });
  if (a.archivedAt)
    throw new AppError("VALIDATION", `"${a.name}" is archived`, { [field]: ["Archived"] });
  return a;
}

function summary(d: DebtDoc, currency: string): DebtSummaryDTO {
  const repaid = Math.max(0, d.principalMinor - d.outstandingMinor);
  return {
    id: String(d._id),
    name: d.name,
    kind: d.kind,
    lender: d.lender,
    accountId: String(d.accountId),
    currency,
    principalMinor: d.principalMinor,
    annualRateBp: d.annualRateBp,
    emiMinor: d.emiMinor,
    outstandingMinor: d.outstandingMinor,
    principalPaidMinor: d.principalPaidMinor,
    interestPaidMinor: d.interestPaidMinor,
    progressBp:
      d.principalMinor > 0 ? Math.min(10_000, Math.round((repaid * 10_000) / d.principalMinor)) : 0,
    nextDueDate: d.nextDueDate,
    projectedPayoffDate: d.projectedPayoffDate,
    status: d.status,
  };
}

// --------------------------------------------------------------------------------- create

/**
 * Creates the loan account and the debt in one DB transaction. A new loan whose money arrived in an
 * account opens at 0 and posts a transfer loan → account of the principal; an existing loan opens at
 * minus the scheduled outstanding after the instalments already paid, on the last of them.
 */
export async function createDebt(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(createDebtSchema, input);
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    const received = data.receivedIntoAccountId
      ? await loadAccountOf(ctx, data.receivedIntoAccountId, "receivedIntoAccountId", session)
      : null;
    const payFrom = data.paymentAccountId
      ? await loadAccountOf(ctx, data.paymentAccountId, "paymentAccountId", session)
      : null;
    const currency = received?.currency ?? payFrom?.currency ?? ctx.baseCurrency;
    const emi = data.emiMinor ?? calcEmi(data.principalMinor, data.annualRateBp, data.tenureMonths);
    const k = data.paidBeforeTracking;
    const openingKey = k > 0 ? dueDate(data.startDate, data.paymentDay, k) : data.startDate;
    if (openingKey > todayOf(ctx)) {
      throw new AppError(
        "VALIDATION",
        "The loan (or its last paid instalment) cannot be in the future",
        {
          startDate: ["Pick an earlier date"],
        },
      );
    }
    const opening = received
      ? 0
      : -outstandingAfter(data.principalMinor, data.annualRateBp, data.tenureMonths, k);
    const [account] = await AccountModel.create(
      [
        {
          userId,
          name: data.name,
          type: "loan",
          currency,
          institution: data.lender,
          openingBalanceMinor: opening,
          openingDate: businessDateToUtc(openingKey, ctx.tz),
          balanceMinor: opening,
          includeInNetWorth: true,
        },
      ],
      { session },
    );
    const [debt] = await DebtModel.create(
      [
        {
          userId,
          name: data.name,
          kind: data.kind,
          accountId: account!._id,
          paymentAccountId: payFrom?._id ?? null,
          principalMinor: data.principalMinor,
          annualRateBp: data.annualRateBp,
          tenureMonths: data.tenureMonths,
          startDate: data.startDate,
          paymentDay: data.paymentDay,
          emiMinor: emi,
          lender: data.lender,
          paidBeforeTracking: k,
          outstandingMinor: -opening,
        },
      ],
      { session },
    );
    if (received) {
      await postTransaction(
        ctx,
        {
          type: "transfer",
          date: businessDateToUtc(data.startDate, ctx.tz),
          amountMinor: data.principalMinor,
          fromAccountId: String(account!._id),
          toAccountId: String(received._id),
          description: `${data.name} disbursed`,
          source: { kind: "system" },
        },
        session,
      );
    }
    await recomputeAccount(userId, account!._id, session);
    await recomputeDebt(ctx, debt!._id, session);
    await writeAudit(
      { userId: ctx.userId, action: "create", entity: "debt", entityId: debt!._id, after: data },
      session,
    );
    return { id: String(debt!._id) };
  });
}

/** The transfer that paid a new loan into an account (posted by createDebt), if any. */
async function disbursementOf(d: DebtDoc, session: ClientSession | null) {
  return TransactionModel.findOne({
    userId: d.userId,
    type: "transfer",
    status: "posted",
    fromAccountId: d.accountId,
    "source.kind": "system",
  })
    .session(session)
    .lean<TransactionDoc>();
}

/**
 * Edit a loan (owner decision: every field, any time). In one DB transaction: the loan account's
 * opening balance/date and the disbursement transfer follow the new terms, recorded payments keep
 * their interest/principal split, and the plan is rebuilt from the resulting outstanding (EMI over
 * the months left, unless an EMI is given).
 */
export async function updateDebt(ctx: Ctx, id: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(updateDebtSchema, input);
  return withTransaction(async (session) => {
    const d = await loadDebt(ctx, id, session);
    const userId = d.userId;
    if (data.paymentAccountId)
      await loadAccountOf(ctx, data.paymentAccountId, "paymentAccountId", session);
    const disbursement = await disbursementOf(d, session);
    if (disbursement && data.paidBeforeTracking > 0) {
      throw new AppError(
        "VALIDATION",
        "This loan was paid into an account as a new loan, so no instalments were paid before it",
        {
          paidBeforeTracking: ["Must be 0 for a new loan"],
        },
      );
    }
    const k = data.paidBeforeTracking;
    const openingKey = k > 0 ? dueDate(data.startDate, data.paymentDay, k) : data.startDate;
    if (openingKey > todayOf(ctx)) {
      throw new AppError(
        "VALIDATION",
        "The loan (or its last paid instalment) cannot be in the future",
        {
          startDate: ["Pick an earlier date"],
        },
      );
    }
    const payments = await TransactionModel.find({
      userId,
      debtId: d._id,
      type: "debt_payment",
      status: "posted",
    })
      .session(session)
      .lean<TransactionDoc[]>();
    const firstPayment = payments.reduce<string | null>((m, t) => {
      const day = utcToBusinessDate(t.date, ctx.tz);
      return !m || day < m ? day : m;
    }, null);
    if (firstPayment && firstPayment < openingKey) {
      throw new AppError(
        "VALIDATION",
        `A payment on ${firstPayment} is before the loan's new start (${openingKey})`,
        {
          startDate: ["Before a recorded payment"],
        },
      );
    }

    const opening = disbursement
      ? 0
      : -outstandingAfter(data.principalMinor, data.annualRateBp, data.tenureMonths, k);
    await AccountModel.updateOne(
      { _id: d.accountId, userId },
      {
        $set: {
          name: data.name,
          institution: data.lender,
          openingBalanceMinor: opening,
          openingDate: businessDateToUtc(openingKey, ctx.tz),
        },
      },
      { session },
    );
    // A new loan's disbursement follows the amount and start date (void + repost, never edited in place).
    if (
      disbursement &&
      (disbursement.amountMinor !== data.principalMinor ||
        utcToBusinessDate(disbursement.date, ctx.tz) !== data.startDate)
    ) {
      await voidTransaction(ctx, String(disbursement._id), "Loan edited", session);
      await postTransaction(
        ctx,
        {
          type: "transfer",
          date: businessDateToUtc(data.startDate, ctx.tz),
          amountMinor: data.principalMinor,
          fromAccountId: String(d.accountId),
          toAccountId: String(disbursement.toAccountId),
          description: `${data.name} disbursed`,
          source: { kind: "system" },
        },
        session,
      );
    }

    const termsChanged =
      data.principalMinor !== d.principalMinor ||
      data.annualRateBp !== d.annualRateBp ||
      data.tenureMonths !== d.tenureMonths ||
      data.startDate !== d.startDate ||
      data.paymentDay !== d.paymentDay ||
      data.paidBeforeTracking !== d.paidBeforeTracking;
    await DebtModel.updateOne(
      { _id: d._id, userId },
      {
        $set: {
          name: data.name,
          kind: data.kind,
          lender: data.lender,
          principalMinor: data.principalMinor,
          annualRateBp: data.annualRateBp,
          tenureMonths: data.tenureMonths,
          startDate: data.startDate,
          paymentDay: data.paymentDay,
          paidBeforeTracking: k,
          paymentAccountId: data.paymentAccountId
            ? new Types.ObjectId(data.paymentAccountId)
            : null,
          ...(data.emiMinor ? { emiMinor: data.emiMinor } : {}),
          // Old prepayments can no longer restore an EMI/tenure the edit replaced.
          ...(termsChanged || data.emiMinor
            ? { prepayments: d.prepayments.map((p) => ({ ...p, reverted: true })) }
            : {}),
        },
      },
      { session },
    );
    await recomputeAccount(userId, d.accountId, session);
    let after = await recomputeDebt(ctx, d._id, session);
    // Rebuild the plan from today's outstanding when the terms changed and no EMI was given.
    if (after && termsChanged && !data.emiMinor && after.outstandingMinor > 0) {
      const monthsLeft = Math.max(1, data.tenureMonths - after.paymentsCount);
      await DebtModel.updateOne(
        { _id: d._id, userId },
        { $set: { emiMinor: calcEmi(after.outstandingMinor, data.annualRateBp, monthsLeft) } },
        { session },
      );
      after = await recomputeDebt(ctx, d._id, session);
    }
    await writeAudit(
      {
        userId: ctx.userId,
        action: "update",
        entity: "debt",
        entityId: d._id,
        before: { ...d, prepayments: undefined },
        after: data,
      },
      session,
    );
    return { id };
  });
}

// ------------------------------------------------------------------------------- payments

export interface DebtPaymentInput {
  date: string;
  amountMinor: number;
  fromAccountId: string;
  notes?: string | null;
  description?: string | null;
  confirmOpportunity?: boolean;
  confirmEmergency?: boolean;
  source?: { kind: SourceKind; refId?: Types.ObjectId | null };
}

export interface DebtPaymentResult {
  transactionId: string;
  principalMinor: number;
  interestMinor: number;
  warnings: string[];
}

/**
 * Posts one loan payment inside the caller's DB transaction (docs/04 §10): interest on the
 * outstanding first, the rest to principal; above the EMI prepays principal, below the interest is
 * all interest (warned). Used by Record payment and recurring rules.
 */
export async function postDebtPayment(
  ctx: Ctx,
  debtId: string,
  data: DebtPaymentInput,
  session: ClientSession,
): Promise<DebtPaymentResult> {
  const d = await loadDebt(ctx, debtId, session);
  if (d.outstandingMinor <= 0) throw new AppError("CONFLICT", "This loan is fully repaid");
  const split = splitPayment(d.outstandingMinor, d.annualRateBp, data.amountMinor);
  if (split.overpaidMinor > 0) {
    throw new AppError("VALIDATION", "This pays more than the loan plus this month's interest", {
      amountMinor: ["Too much"],
    });
  }
  const txn = await postTransaction(
    ctx,
    {
      type: "debt_payment",
      date: businessDateToUtc(data.date, ctx.tz),
      amountMinor: data.amountMinor,
      fromAccountId: data.fromAccountId,
      toAccountId: String(d.accountId),
      debtId: d._id,
      principalMinor: split.principalMinor,
      interestMinor: split.interestMinor,
      description: data.description || `${d.name} payment`,
      notes: data.notes ?? null,
      confirmOpportunity: data.confirmOpportunity,
      confirmEmergency: data.confirmEmergency,
      source: data.source,
    },
    session,
  );
  return {
    transactionId: String(txn._id),
    principalMinor: split.principalMinor,
    interestMinor: split.interestMinor,
    warnings: split.short
      ? ["The payment is less than this month's interest: nothing went to principal"]
      : [],
  };
}

/** Record payment from the loan page. */
export async function recordPayment(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<DebtPaymentResult> {
  const data = parseInput(paymentSchema, input);
  return withTransaction((session) => postDebtPayment(ctx, id, data, session));
}

function planFrom(d: DebtDoc, outstanding: number, emi: number, monthsLeft: number) {
  if (outstanding <= 0 || monthsLeft <= 0)
    return { payoffDate: null as string | null, interestLeftMinor: 0, months: 0 };
  const rows = amortisation({
    outstandingMinor: outstanding,
    annualRateBp: d.annualRateBp,
    emiMinor: emi,
    months: monthsLeft,
    startDate: d.startDate,
    paymentDay: d.paymentDay,
    startNo: d.paymentsCount + 1,
  });
  return {
    payoffDate: rows.at(-1)?.dueDate ?? null,
    interestLeftMinor: rows.reduce((s, r) => s + r.interestMinor, 0),
    months: rows.length,
  };
}

function prepaymentPlan(d: DebtDoc, amountMinor: number, mode: "reduce_tenure" | "reduce_emi") {
  if (amountMinor > d.outstandingMinor) {
    throw new AppError("VALIDATION", "A prepayment cannot be more than what is owed", {
      amountMinor: ["Too much"],
    });
  }
  const monthsLeft = Math.max(1, d.tenureMonths - d.paymentsCount);
  const before = planFrom(d, d.outstandingMinor, d.emiMinor, monthsLeft);
  const after = applyPrepayment({
    outstandingAfterMinor: d.outstandingMinor - amountMinor,
    annualRateBp: d.annualRateBp,
    emiMinor: d.emiMinor,
    monthsLeft,
    mode,
  });
  const afterPlan = planFrom(d, d.outstandingMinor - amountMinor, after.emiMinor, after.monthsLeft);
  return {
    monthsLeft,
    after,
    preview: {
      before: {
        emiMinor: d.emiMinor,
        monthsLeft: before.months,
        payoffDate: before.payoffDate,
        interestLeftMinor: before.interestLeftMinor,
      },
      after: {
        emiMinor: after.emiMinor,
        monthsLeft: afterPlan.months,
        payoffDate: afterPlan.payoffDate,
        interestLeftMinor: afterPlan.interestLeftMinor,
      },
    } satisfies PrepaymentPreviewDTO,
  };
}

export async function previewPrepayment(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<PrepaymentPreviewDTO> {
  const data = parseInput(prepaymentPreviewSchema, input);
  await connectDb();
  return prepaymentPlan(await loadDebt(ctx, id), data.amountMinor, data.mode).preview;
}

/** Prepayment: a principal-only payment, then the plan is re-made (reduce tenure or EMI). */
export async function recordPrepayment(
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<PrepaymentPreviewDTO> {
  const data = parseInput(prepaymentSchema, input);
  return withTransaction(async (session) => {
    const d = await loadDebt(ctx, id, session);
    if (d.outstandingMinor <= 0) throw new AppError("CONFLICT", "This loan is fully repaid");
    const plan = prepaymentPlan(d, data.amountMinor, data.mode);
    const txn = await postTransaction(
      ctx,
      {
        type: "debt_payment",
        date: businessDateToUtc(data.date, ctx.tz),
        amountMinor: data.amountMinor,
        fromAccountId: data.fromAccountId,
        toAccountId: String(d.accountId),
        debtId: d._id,
        principalMinor: data.amountMinor,
        interestMinor: 0,
        description: `${d.name} prepayment (${data.mode === "reduce_emi" ? "lower EMI" : "shorter term"})`,
        confirmOpportunity: data.confirmOpportunity,
        confirmEmergency: data.confirmEmergency,
      },
      session,
    );
    const tenureAfter = d.paymentsCount + plan.after.monthsLeft;
    await DebtModel.updateOne(
      { _id: d._id, userId: d.userId },
      {
        $set: { emiMinor: plan.after.emiMinor, tenureMonths: tenureAfter },
        $push: {
          prepayments: {
            date: data.date,
            amountMinor: data.amountMinor,
            mode: data.mode,
            transactionId: txn._id,
            emiBeforeMinor: d.emiMinor,
            tenureBeforeMonths: d.tenureMonths,
            emiAfterMinor: plan.after.emiMinor,
            tenureAfterMonths: tenureAfter,
            reverted: false,
          },
        },
      },
      { session },
    );
    await recomputeDebt(ctx, d._id, session);
    await writeAudit(
      {
        userId: ctx.userId,
        action: "prepay",
        entity: "debt",
        entityId: d._id,
        after: { amount: data.amountMinor, mode: data.mode },
      },
      session,
    );
    return plan.preview;
  });
}

// ---------------------------------------------------------------------------------- reads

export async function getDebt(ctx: Ctx, id: string): Promise<DebtDetailDTO> {
  await connectDb();
  const d = await loadDebt(ctx, id);
  const userId = uid(ctx);
  const [account, txns, accounts] = await Promise.all([
    AccountModel.findOne({ _id: d.accountId, userId }).lean<AccountDoc>(),
    TransactionModel.find({ userId, debtId: d._id, type: "debt_payment" })
      .sort({ date: 1, createdAt: 1 })
      .lean<TransactionDoc[]>(),
    AccountModel.find({ userId, archivedAt: null }).sort({ name: 1 }).lean<AccountDoc[]>(),
  ]);
  const names = new Map(accounts.map((a) => [String(a._id), a.name]));
  const disbursed = await disbursementOf(d, null);
  const prepaymentIds = new Set(
    d.prepayments.filter((p) => !p.reverted).map((p) => String(p.transactionId)),
  );

  const schedule: ScheduleRowDTO[] = [];
  if (d.paidBeforeTracking > 0) {
    const original = amortisation({
      outstandingMinor: d.principalMinor,
      annualRateBp: d.annualRateBp,
      emiMinor: calcEmi(
        d.principalMinor,
        d.annualRateBp,
        d.prepayments[0]?.tenureBeforeMonths ?? d.tenureMonths,
      ),
      months: d.prepayments[0]?.tenureBeforeMonths ?? d.tenureMonths,
      startDate: d.startDate,
      paymentDay: d.paymentDay,
      maxRows: d.paidBeforeTracking,
    });
    schedule.push(...original.map((r) => ({ ...r, state: "before_tracking" as const })));
  }
  if (d.outstandingMinor > 0) {
    try {
      const rows = amortisation({
        outstandingMinor: d.outstandingMinor,
        annualRateBp: d.annualRateBp,
        emiMinor: d.emiMinor,
        months: Math.max(1, d.tenureMonths - d.paymentsCount),
        startDate: d.startDate,
        paymentDay: d.paymentDay,
        startNo: d.paymentsCount + 1,
      });
      schedule.push(...rows.map((r) => ({ ...r, state: "projected" as const })));
    } catch {
      // EMI no longer covers the interest: no projection
    }
  }
  const payments: DebtPaymentDTO[] = txns.map((t) => ({
    id: String(t._id),
    date: utcToBusinessDate(t.date, ctx.tz),
    amountMinor: t.amountMinor,
    principalMinor: t.principalMinor ?? 0,
    interestMinor: t.interestMinor ?? 0,
    fromAccount: t.fromAccountId ? (names.get(String(t.fromAccountId)) ?? "Account") : "",
    prepayment: prepaymentIds.has(String(t._id)),
    status: t.status,
  }));
  const currency = account?.currency ?? ctx.baseCurrency;
  return {
    ...summary(d, currency),
    tenureMonths: d.tenureMonths,
    startDate: d.startDate,
    paymentDay: d.paymentDay,
    paidBeforeTracking: d.paidBeforeTracking,
    paymentsCount: d.paymentsCount,
    paymentAccountId: d.paymentAccountId ? String(d.paymentAccountId) : null,
    disbursedInto: disbursed?.toAccountId ? String(disbursed.toAccountId) : null,
    nextInterestMinor: roundHalfAwayFromZero(d.outstandingMinor * monthlyRate(d.annualRateBp)),
    schedule,
    payments,
    accounts: accounts
      .filter(
        (a) =>
          ["bank", "cash", "wallet", "broker_cash", "credit_card"].includes(a.type) &&
          a.currency === currency,
      )
      .map((a) => ({
        id: String(a._id),
        name: a.name,
        currency: a.currency,
        balanceMinor: a.balanceMinor,
      })),
  };
}

/** Average monthly income (income + paid-out investment income) of the last 3 complete months, base currency. */
async function avgMonthlyIncome(ctx: Ctx): Promise<number> {
  const today = todayOf(ctx);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthStart = (offset: number) => {
    const t = y * 12 + (m - 1) - offset;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
  };
  const from = businessDateToUtc(monthStart(3), ctx.tz);
  const to = businessDateToUtc(monthStart(0), ctx.tz);
  const [txns, toBase] = await Promise.all([
    TransactionModel.find({
      userId: uid(ctx),
      status: "posted",
      type: { $in: ["income", "investment_income"] },
      date: { $gte: from, $lt: to },
    }).lean<TransactionDoc[]>(),
    loadToBase(ctx),
  ]);
  let total = 0;
  for (const t of txns) {
    if (t.type === "investment_income" && t.reinvest) continue;
    total += toBase(t.amountMinor, t.currency, utcToBusinessDate(t.date, ctx.tz)) ?? 0;
  }
  return Math.round(total / 3);
}

export async function listDebts(ctx: Ctx): Promise<DebtsOverviewDTO> {
  await connectDb();
  const userId = uid(ctx);
  const today = todayOf(ctx);
  const [debts, accounts, toBase, income] = await Promise.all([
    DebtModel.find({ userId }).sort({ status: 1, name: 1 }).lean<DebtDoc[]>(),
    AccountModel.find({ userId, archivedAt: null }).sort({ name: 1 }).lean<AccountDoc[]>(),
    loadToBase(ctx),
    avgMonthlyIncome(ctx),
  ]);
  const currencyOf = new Map(accounts.map((a) => [String(a._id), a.currency]));
  let outstanding = 0;
  let emi = 0;
  let fxMissing = 0;
  for (const d of debts) {
    if (d.status !== "active") continue;
    const ccy = currencyOf.get(String(d.accountId)) ?? ctx.baseCurrency;
    const o = toBase(d.outstandingMinor, ccy, today);
    const e = toBase(d.emiMinor, ccy, today);
    if (o === null || e === null) {
      fxMissing += 1;
      continue;
    }
    outstanding += o;
    emi += e;
  }
  const counterparties: CounterpartyDTO[] = accounts
    .filter((a) => (a.type === "receivable" || a.type === "payable") && a.balanceMinor !== 0)
    .map((a) => ({
      id: String(a._id),
      name: a.name,
      type: a.type as "receivable" | "payable",
      counterparty: a.counterparty,
      balanceMinor: a.balanceMinor,
      currency: a.currency,
    }));
  return {
    baseCurrency: ctx.baseCurrency,
    todayKey: today,
    debts: debts.map((d) => summary(d, currencyOf.get(String(d.accountId)) ?? ctx.baseCurrency)),
    totals: { outstandingMinor: outstanding, monthlyEmiMinor: emi, fxMissing },
    dtiBp: dtiBp(emi, income),
    avgMonthlyIncomeMinor: income,
    counterparties,
    accounts: accounts
      .filter((a) => ["bank", "cash", "wallet", "broker_cash"].includes(a.type))
      .map((a) => ({
        id: String(a._id),
        name: a.name,
        currency: a.currency,
        balanceMinor: a.balanceMinor,
      })),
  };
}

/** EMIs due up to `until` (overdue ones included) for Upcoming / safe to spend (docs/04 §21). */
export async function debtUpcoming(
  ctx: Ctx,
  until: string,
): Promise<
  {
    id: string;
    title: string;
    dueDate: string;
    amountMinor: number;
    currency: string;
    outflowMinor: number | null;
    accountId: string | null;
    href: string;
  }[]
> {
  await connectDb();
  const userId = uid(ctx);
  const [debts, accounts] = await Promise.all([
    DebtModel.find({ userId, status: "active", nextDueDate: { $ne: null } }).lean<DebtDoc[]>(),
    AccountModel.find({ userId }).lean<AccountDoc[]>(),
  ]);
  const byId = new Map(accounts.map((a) => [String(a._id), a]));
  const out = [];
  for (const d of debts) {
    const loan = byId.get(String(d.accountId));
    const payFrom = d.paymentAccountId ? byId.get(String(d.paymentAccountId)) : undefined;
    const earmarkable = payFrom ? isEarmarkable(payFrom) : false;
    let left = d.outstandingMinor;
    for (let i = 1; left > 0 && i <= 24; i++) {
      const due = dueDate(d.startDate, d.paymentDay, d.paymentsCount + i);
      if (due > until) break;
      const amount = Math.min(
        d.emiMinor,
        left + roundHalfAwayFromZero(left * monthlyRate(d.annualRateBp)),
      );
      out.push({
        id: `emi-${String(d._id)}-${d.paymentsCount + i}`,
        title: `${d.name} EMI`,
        dueDate: due,
        amountMinor: amount,
        currency: loan?.currency ?? ctx.baseCurrency,
        outflowMinor: earmarkable ? amount : null,
        accountId: payFrom ? String(payFrom._id) : null,
        href: `/debts/${String(d._id)}`,
      });
      left -= Math.max(0, amount - roundHalfAwayFromZero(left * monthlyRate(d.annualRateBp)));
    }
  }
  return out;
}

// -------------------------------------------------------------------- receivables/payables

/**
 * Settle a receivable (money owed to you arrives: transfer receivable → account) or a payable (you
 * pay it: transfer account → payable). Never more than the open balance.
 */
export async function settleCounterparty(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(settleSchema, input);
  return withTransaction(async (session) => {
    const cp = await loadAccountOf(ctx, data.accountId, "accountId", session);
    if (cp.type !== "receivable" && cp.type !== "payable") {
      throw new AppError("VALIDATION", "Only receivables and payables are settled here");
    }
    const open = Math.abs(cp.balanceMinor);
    if (open === 0) throw new AppError("CONFLICT", `"${cp.name}" is already settled`);
    if (data.amountMinor > open) {
      throw new AppError("VALIDATION", "That is more than the open balance", {
        amountMinor: ["Too much"],
      });
    }
    const owedToMe = cp.balanceMinor > 0;
    const txn = await postTransaction(
      ctx,
      {
        type: "transfer",
        date: businessDateToUtc(data.date, ctx.tz),
        amountMinor: data.amountMinor,
        fromAccountId: owedToMe ? data.accountId : data.otherAccountId,
        toAccountId: owedToMe ? data.otherAccountId : data.accountId,
        description: `Settle ${cp.name}`,
        counterparty: cp.counterparty,
        confirmOpportunity: data.confirmOpportunity,
        confirmEmergency: data.confirmEmergency,
      },
      session,
    );
    return { id: String(txn._id) };
  });
}
