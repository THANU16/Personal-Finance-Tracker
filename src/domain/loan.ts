// Loans (docs/04 §10). Pure: no DB, no Next.js. Money is integer minor units, rates are basis points
// per year, dates are business date keys `YYYY-MM-DD`.
import { roundHalfAwayFromZero } from "@/domain/money";

/** Monthly rate as a fraction: annualRateBp / 10000 / 12. */
export const monthlyRate = (annualRateBp: number) => annualRateBp / 10_000 / 12;

/** EMI = P·r·(1+r)^n / ((1+r)^n − 1); r = 0 → P / n. Rounded to the minor unit. */
export function emiMinor(principalMinor: number, annualRateBp: number, months: number): number {
  if (!Number.isSafeInteger(principalMinor) || principalMinor < 0)
    throw new RangeError("principal");
  if (!Number.isInteger(months) || months < 1) throw new RangeError("months");
  if (principalMinor === 0) return 0;
  const r = monthlyRate(annualRateBp);
  if (r === 0) return Math.ceil(principalMinor / months);
  const f = Math.pow(1 + r, months);
  return roundHalfAwayFromZero((principalMinor * r * f) / (f - 1));
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m 1-based

/** The `index`-th monthly due date (1 = the month after `startDate`), day clamped to month end. */
export function dueDate(startDate: string, paymentDay: number, index: number): string {
  const [y, m] = startDate.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + index;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(paymentDay, daysIn(yy, mm)))}`;
}

export interface ScheduleRow {
  no: number;
  dueDate: string;
  openingMinor: number;
  emiMinor: number;
  interestMinor: number;
  principalMinor: number;
  closingMinor: number;
}

/**
 * Amortisation from `outstanding` (docs/04 §10): interest = round(outstanding × r), principal =
 * EMI − interest; the final row (or any row where EMI would overpay) pays the remaining outstanding.
 * Stops when paid off or after `maxRows`. `startNo` numbers rows after earlier instalments.
 */
export function amortisation(input: {
  outstandingMinor: number;
  annualRateBp: number;
  emiMinor: number;
  months: number;
  startDate: string;
  paymentDay: number;
  startNo?: number;
  maxRows?: number;
}): ScheduleRow[] {
  const r = monthlyRate(input.annualRateBp);
  const startNo = input.startNo ?? 1;
  const maxRows = input.maxRows ?? 1200;
  const rows: ScheduleRow[] = [];
  let outstanding = input.outstandingMinor;
  for (let i = 0; outstanding > 0 && i < maxRows; i++) {
    const no = startNo + i;
    const interest = roundHalfAwayFromZero(outstanding * r);
    const last = i === input.months - 1 || input.emiMinor - interest >= outstanding;
    if (!last && input.emiMinor <= interest) {
      throw new RangeError("EMI does not cover the interest; the loan never pays off");
    }
    const principal = last ? outstanding : input.emiMinor - interest;
    rows.push({
      no,
      dueDate: dueDate(input.startDate, input.paymentDay, no),
      openingMinor: outstanding,
      emiMinor: principal + interest,
      interestMinor: interest,
      principalMinor: principal,
      closingMinor: outstanding - principal,
    });
    outstanding -= principal;
  }
  return rows;
}

/**
 * Splits a payment (docs/04 §10): interest = round(outstanding × r), principal = the rest (never more
 * than the outstanding). A payment below the interest is all interest (`short`).
 */
export function splitPayment(
  outstandingMinor: number,
  annualRateBp: number,
  amountMinor: number,
): { interestMinor: number; principalMinor: number; short: boolean; overpaidMinor: number } {
  const due = roundHalfAwayFromZero(Math.max(0, outstandingMinor) * monthlyRate(annualRateBp));
  if (amountMinor <= due) {
    return {
      interestMinor: amountMinor,
      principalMinor: 0,
      short: amountMinor < due,
      overpaidMinor: 0,
    };
  }
  const principal = Math.min(amountMinor - due, Math.max(0, outstandingMinor));
  return {
    interestMinor: due,
    principalMinor: principal,
    short: false,
    overpaidMinor: amountMinor - due - principal,
  };
}

/** Months needed to repay `outstanding` with `emi` at `rate` (reduce-tenure prepayment). */
export function monthsToRepay(outstandingMinor: number, annualRateBp: number, emi: number): number {
  if (outstandingMinor <= 0) return 0;
  const r = monthlyRate(annualRateBp);
  if (r === 0) return Math.ceil(outstandingMinor / emi);
  const interest = outstandingMinor * r;
  if (emi <= interest) throw new RangeError("EMI does not cover the interest");
  return Math.ceil(-Math.log(1 - interest / emi) / Math.log(1 + r) - 1e-9);
}

export type PrepaymentMode = "reduce_tenure" | "reduce_emi";

/**
 * After a principal prepayment: `reduce_tenure` keeps the EMI and recomputes the months left;
 * `reduce_emi` keeps the months left and recomputes the EMI.
 */
export function applyPrepayment(input: {
  outstandingAfterMinor: number;
  annualRateBp: number;
  emiMinor: number;
  monthsLeft: number;
  mode: PrepaymentMode;
}): { emiMinor: number; monthsLeft: number } {
  if (input.outstandingAfterMinor <= 0) return { emiMinor: input.emiMinor, monthsLeft: 0 };
  if (input.mode === "reduce_emi") {
    const months = Math.max(1, input.monthsLeft);
    return {
      emiMinor: emiMinor(input.outstandingAfterMinor, input.annualRateBp, months),
      monthsLeft: months,
    };
  }
  return {
    emiMinor: input.emiMinor,
    monthsLeft: monthsToRepay(input.outstandingAfterMinor, input.annualRateBp, input.emiMinor),
  };
}

/** Outstanding per the original schedule after `paid` instalments (an existing loan's start). */
export function outstandingAfter(
  principalMinor: number,
  annualRateBp: number,
  months: number,
  paid: number,
): number {
  if (paid <= 0) return principalMinor;
  const emi = emiMinor(principalMinor, annualRateBp, months);
  const rows = amortisation({
    outstandingMinor: principalMinor,
    annualRateBp,
    emiMinor: emi,
    months,
    startDate: "2000-01-01",
    paymentDay: 1,
    maxRows: paid,
  });
  return rows.at(-1)?.closingMinor ?? principalMinor;
}

/** Debt-to-income in bp: Σ monthly EMIs ÷ average monthly income; null without income. */
export function dtiBp(totalEmiMinor: number, avgMonthlyIncomeMinor: number): number | null {
  if (avgMonthlyIncomeMinor <= 0) return null;
  return Math.round((totalEmiMinor * 10_000) / avgMonthlyIncomeMinor);
}
