import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — debts. The loan itself is an account of type `loan` (negative balance); the debt holds the
// terms and caches rebuilt by recomputeDebt() from the ledger. Dates are business date keys.

export const DEBT_KINDS = ["bank_loan", "leasing", "personal", "other"] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];
export const PREPAYMENT_MODES = ["reduce_tenure", "reduce_emi"] as const;

export interface PrepaymentDoc {
  date: string;
  amountMinor: number;
  mode: (typeof PREPAYMENT_MODES)[number];
  transactionId: Types.ObjectId;
  emiBeforeMinor: number;
  tenureBeforeMonths: number;
  emiAfterMinor: number;
  tenureAfterMonths: number;
  /** The prepayment's transaction was voided and the EMI/tenure restored. */
  reverted: boolean;
}

export interface DebtDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: DebtKind;
  /** The loan account (type loan). */
  accountId: Types.ObjectId;
  /** Default account EMIs are paid from (pre-fill, upcoming outflows). */
  paymentAccountId: Types.ObjectId | null;
  principalMinor: number;
  annualRateBp: number;
  /** Total instalments of the current plan (changes with reduce-tenure prepayments). */
  tenureMonths: number;
  startDate: string;
  paymentDay: number;
  emiMinor: number;
  lender: string | null;
  /** Instalments paid before the loan was tracked here (existing loans). */
  paidBeforeTracking: number;
  status: "active" | "closed";
  closedAt: Date | null;
  prepayments: PrepaymentDoc[];
  // caches — recomputeDebt
  outstandingMinor: number;
  principalPaidMinor: number;
  interestPaidMinor: number;
  paymentsCount: number;
  nextDueDate: string | null;
  projectedPayoffDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const prepaymentSchema = new Schema<PrepaymentDoc>(
  {
    date: { type: String, required: true },
    amountMinor: intField({ required: true, min: 1 }),
    mode: { type: String, enum: PREPAYMENT_MODES, required: true },
    transactionId: { type: Schema.Types.ObjectId, required: true },
    emiBeforeMinor: intField({ required: true, min: 0 }),
    tenureBeforeMonths: intField({ required: true, min: 0 }),
    emiAfterMinor: intField({ required: true, min: 0 }),
    tenureAfterMonths: intField({ required: true, min: 0 }),
    reverted: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const debtSchema = new Schema<DebtDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: DEBT_KINDS, required: true },
    accountId: { type: Schema.Types.ObjectId, required: true },
    paymentAccountId: { type: Schema.Types.ObjectId, default: null },
    principalMinor: intField({ required: true, min: 1 }),
    annualRateBp: intField({ required: true, min: 0, max: 10_000 }),
    tenureMonths: intField({ required: true, min: 0, max: 1200 }),
    startDate: { type: String, required: true },
    paymentDay: intField({ required: true, min: 1, max: 31 }),
    emiMinor: intField({ required: true, min: 0 }),
    lender: { type: String, default: null },
    paidBeforeTracking: intField({ required: true, default: 0, min: 0 }),
    status: { type: String, enum: ["active", "closed"], required: true, default: "active" },
    closedAt: { type: Date, default: null },
    prepayments: { type: [prepaymentSchema], default: [] },
    outstandingMinor: intField({ required: true, default: 0 }),
    principalPaidMinor: intField({ required: true, default: 0 }),
    interestPaidMinor: intField({ required: true, default: 0 }),
    paymentsCount: intField({ required: true, default: 0, min: 0 }),
    nextDueDate: { type: String, default: null },
    projectedPayoffDate: { type: String, default: null },
  },
  { timestamps: true },
);
debtSchema.index({ userId: 1, accountId: 1 }, { unique: true });
debtSchema.index({ userId: 1, status: 1 });

export const DebtModel = userScopedModel<DebtDoc>("Debt", debtSchema, "debts");
