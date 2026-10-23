import { z } from "zod";
import { dateKey } from "@/modules/accounts/schemas";
import { DEBT_KINDS, PREPAYMENT_MODES } from "@/modules/debts/model";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const amountMinor = z
  .number({ error: "Enter an amount" })
  .int("Must be a whole amount")
  .positive("Enter an amount above zero")
  .max(Number.MAX_SAFE_INTEGER);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));
const confirmFlags = {
  confirmOpportunity: z.boolean().optional(),
  confirmEmergency: z.boolean().optional(),
};

export const createDebtSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(60),
    kind: z.enum(DEBT_KINDS),
    lender: text(80),
    principalMinor: amountMinor,
    annualRateBp: z
      .number()
      .int("Use whole basis points")
      .min(0, "Cannot be negative")
      .max(10_000, "At most 100%"),
    tenureMonths: z
      .number()
      .int("Whole months")
      .min(1, "At least 1 month")
      .max(600, "At most 50 years"),
    startDate: dateKey,
    paymentDay: z.number().int().min(1, "Day 1–31").max(31, "Day 1–31"),
    /** Optional: the lender's EMI when it differs from the formula by a few cents. */
    emiMinor: amountMinor.nullish(),
    paymentAccountId: objectId.nullish(),
    /** New loan: the account the money arrived in (loan opens at 0 + transfer loan → account). */
    receivedIntoAccountId: objectId.nullish(),
    /** Existing loan: instalments already paid before tracking it here. */
    paidBeforeTracking: z.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.paidBeforeTracking >= v.tenureMonths) {
      ctx.addIssue({
        code: "custom",
        path: ["paidBeforeTracking"],
        message: "Fewer than the tenure",
      });
    }
    if (v.receivedIntoAccountId && v.paidBeforeTracking > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["receivedIntoAccountId"],
        message: "Only a new loan arrives in an account; an existing one has instalments paid",
      });
    }
  });
export type CreateDebtInput = z.input<typeof createDebtSchema>;

/**
 * Edit a loan (owner decision: everything, any time). Past payments keep their split; the plan is
 * rebuilt from the new outstanding. `emiMinor` null = recalculate over the months left.
 */
export const updateDebtSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(60),
    kind: z.enum(DEBT_KINDS),
    lender: text(80),
    principalMinor: amountMinor,
    annualRateBp: z
      .number()
      .int("Use whole basis points")
      .min(0, "Cannot be negative")
      .max(10_000, "At most 100%"),
    tenureMonths: z
      .number()
      .int("Whole months")
      .min(1, "At least 1 month")
      .max(600, "At most 50 years"),
    startDate: dateKey,
    paymentDay: z.number().int().min(1, "Day 1–31").max(31, "Day 1–31"),
    paidBeforeTracking: z.number().int().min(0),
    emiMinor: amountMinor.nullable(),
    paymentAccountId: objectId.nullable(),
  })
  .strict()
  .refine((v) => v.paidBeforeTracking < v.tenureMonths, {
    path: ["paidBeforeTracking"],
    message: "Fewer than the tenure",
  });

export const paymentSchema = z
  .object({
    date: dateKey,
    amountMinor,
    fromAccountId: objectId,
    notes: text(500),
    ...confirmFlags,
  })
  .strict();

export const prepaymentSchema = z
  .object({
    date: dateKey,
    amountMinor,
    fromAccountId: objectId,
    mode: z.enum(PREPAYMENT_MODES),
    ...confirmFlags,
  })
  .strict();

export const prepaymentPreviewSchema = z
  .object({ amountMinor, mode: z.enum(PREPAYMENT_MODES) })
  .strict();

export const settleSchema = z
  .object({
    accountId: objectId,
    otherAccountId: objectId,
    amountMinor,
    date: dateKey,
    ...confirmFlags,
  })
  .strict();

// ----------------------------------------------------------------------------------- DTOs

export interface DebtSummaryDTO {
  id: string;
  name: string;
  kind: (typeof DEBT_KINDS)[number];
  lender: string | null;
  accountId: string;
  currency: string;
  principalMinor: number;
  annualRateBp: number;
  emiMinor: number;
  outstandingMinor: number;
  principalPaidMinor: number;
  interestPaidMinor: number;
  /** Repaid share of the principal, bp. */
  progressBp: number;
  nextDueDate: string | null;
  projectedPayoffDate: string | null;
  status: "active" | "closed";
}

export interface ScheduleRowDTO {
  no: number;
  dueDate: string;
  openingMinor: number;
  emiMinor: number;
  interestMinor: number;
  principalMinor: number;
  closingMinor: number;
  state: "before_tracking" | "projected";
}

export interface DebtPaymentDTO {
  id: string;
  date: string;
  amountMinor: number;
  principalMinor: number;
  interestMinor: number;
  fromAccount: string;
  prepayment: boolean;
  status: "posted" | "void";
}

export interface DebtDetailDTO extends DebtSummaryDTO {
  tenureMonths: number;
  startDate: string;
  paymentDay: number;
  paidBeforeTracking: number;
  paymentsCount: number;
  paymentAccountId: string | null;
  /** The account a new loan was paid into (its disbursement transfer), if recorded. */
  disbursedInto: string | null;
  /** Interest of the next instalment on the current outstanding. */
  nextInterestMinor: number;
  /** Everything paid so far: scheduled instalments before tracking + recorded payments. */
  totalPaidMinor: number;
  /** The before-tracking part of totalPaidMinor (from the original schedule). */
  paidBeforeTrackingMinor: number;
  /** Paid + remaining schedule − principal (docs/04 §10); null when it can't be projected. */
  totalInterestMinor: number | null;
  schedule: ScheduleRowDTO[];
  payments: DebtPaymentDTO[];
  accounts: { id: string; name: string; currency: string; balanceMinor: number }[];
}

export interface CounterpartyDTO {
  id: string;
  name: string;
  type: "receivable" | "payable";
  counterparty: string | null;
  balanceMinor: number;
  currency: string;
}

export interface DebtsOverviewDTO {
  baseCurrency: string;
  todayKey: string;
  debts: DebtSummaryDTO[];
  totals: { outstandingMinor: number; monthlyEmiMinor: number; fxMissing: number };
  /** Σ active EMIs ÷ average monthly income of the last 3 complete months (bp). */
  dtiBp: number | null;
  avgMonthlyIncomeMinor: number;
  counterparties: CounterpartyDTO[];
  accounts: { id: string; name: string; currency: string; balanceMinor: number }[];
}

export interface PrepaymentPreviewDTO {
  before: {
    emiMinor: number;
    monthsLeft: number;
    payoffDate: string | null;
    interestLeftMinor: number;
  };
  after: {
    emiMinor: number;
    monthsLeft: number;
    payoffDate: string | null;
    interestLeftMinor: number;
  };
}
