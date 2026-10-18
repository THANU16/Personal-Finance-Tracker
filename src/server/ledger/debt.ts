import "server-only";
import type { ClientSession, Types } from "mongoose";
import { amortisation, dueDate } from "@/domain/loan";
import { utcToBusinessDate } from "@/domain/dates";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { DebtModel, type DebtDoc } from "@/modules/debts/model";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { toObjectId } from "@/server/db/ids";

/**
 * Rebuilds a debt's caches from the ledger (docs/04 §10): outstanding = −(loan account balance),
 * principal/interest paid, instalments paid, next due date and projected payoff. A voided
 * prepayment restores the EMI/tenure it changed (latest first). Closes the debt at 0, reopens it
 * when a payment is voided. Must run after the loan account was recomputed.
 */
export async function recomputeDebt(
  ctx: { userId: string; tz: string },
  debtId: Types.ObjectId,
  session: ClientSession | null,
): Promise<DebtDoc | null> {
  const debt = await DebtModel.findOne({ _id: debtId, userId: toObjectId(ctx.userId, "User") })
    .session(session)
    .lean<DebtDoc>();
  if (!debt) return null;
  const account = await AccountModel.findOne({ _id: debt.accountId, userId: debt.userId })
    .session(session)
    .lean<AccountDoc>();
  const txns = await TransactionModel.find({
    userId: debt.userId,
    debtId: debt._id,
    type: "debt_payment",
  })
    .session(session)
    .lean<TransactionDoc[]>();
  const posted = txns.filter((t) => t.status === "posted");
  const status = new Map(txns.map((t) => [String(t._id), t.status]));

  // Undo plan changes of voided prepayments, newest first.
  let emi = debt.emiMinor;
  let tenure = debt.tenureMonths;
  const prepayments = debt.prepayments.map((p) => ({ ...p }));
  for (let i = prepayments.length - 1; i >= 0; i--) {
    const p = prepayments[i]!;
    if (!p.reverted && status.get(String(p.transactionId)) === "void") {
      emi = p.emiBeforeMinor;
      tenure = p.tenureBeforeMonths;
      p.reverted = true;
    }
  }
  const prepaymentIds = new Set(
    prepayments.filter((p) => !p.reverted).map((p) => String(p.transactionId)),
  );

  const outstanding = Math.max(0, -(account?.balanceMinor ?? 0));
  const principalPaid = posted.reduce((s, t) => s + (t.principalMinor ?? 0), 0);
  const interestPaid = posted.reduce((s, t) => s + (t.interestMinor ?? 0), 0);
  const regular = posted.filter((t) => !prepaymentIds.has(String(t._id))).length;
  const paid = debt.paidBeforeTracking + regular;

  let nextDueDate: string | null = null;
  let projectedPayoffDate: string | null = null;
  if (outstanding > 0) {
    nextDueDate = dueDate(debt.startDate, debt.paymentDay, paid + 1);
    try {
      const rows = amortisation({
        outstandingMinor: outstanding,
        annualRateBp: debt.annualRateBp,
        emiMinor: emi,
        months: Math.max(1, tenure - paid),
        startDate: debt.startDate,
        paymentDay: debt.paymentDay,
        startNo: paid + 1,
      });
      projectedPayoffDate = rows.at(-1)?.dueDate ?? null;
    } catch {
      projectedPayoffDate = null; // EMI no longer covers the interest
    }
  } else if (posted.length) {
    const last = posted.reduce((m, t) => (t.date > m ? t.date : m), posted[0]!.date);
    projectedPayoffDate = utcToBusinessDate(last, ctx.tz);
  }

  const closed = outstanding === 0 && posted.length > 0;
  const next: Partial<DebtDoc> = {
    emiMinor: emi,
    tenureMonths: tenure,
    prepayments,
    outstandingMinor: outstanding,
    principalPaidMinor: principalPaid,
    interestPaidMinor: interestPaid,
    paymentsCount: paid,
    nextDueDate,
    projectedPayoffDate,
    status: closed ? "closed" : "active",
    closedAt: closed ? (debt.closedAt ?? new Date()) : null,
  };
  await DebtModel.updateOne(
    { _id: debt._id, userId: debt.userId },
    { $set: next },
    { session: session ?? undefined },
  );
  return { ...debt, ...next } as DebtDoc;
}
