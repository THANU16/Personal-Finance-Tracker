import { z } from "zod";
import { DATE_RANGE_PRESETS } from "@/domain/date-range";
import { dateKey } from "@/modules/accounts/schemas";
import type { TransactionStatus, TransactionType } from "@/domain/ledger";
import type { SourceKind } from "@/modules/transactions/model";

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
const tags = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(30, "Tags are at most 30 characters")
      .regex(/^[^,]+$/, "Tags cannot contain commas"),
  )
  .max(10, "Use at most 10 tags")
  .default([])
  .transform((t) => Array.from(new Set(t)));

const base = {
  date: dateKey,
  amountMinor,
  description: text(200),
  counterparty: text(100),
  notes: text(1000),
  tags,
  /** Dip guard (docs/04 §20): retry flags after NEEDS_CONFIRMATION. Emergency needs its own flag. */
  confirmOpportunity: z.boolean().optional(),
  confirmEmergency: z.boolean().optional(),
};

export const splitLineSchema = z
  .object({ categoryId: objectId, amountMinor, note: text(100) })
  .strict();

const incomeSchema = z
  .object({ ...base, type: z.literal("income"), toAccountId: objectId, categoryId: objectId })
  .strict();

const expenseSchema = z
  .object({
    ...base,
    type: z.literal("expense"),
    fromAccountId: objectId,
    categoryId: objectId.nullish(),
    splits: z.array(splitLineSchema).max(20).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasSplits = Boolean(v.splits?.length);
    if (hasSplits && v.categoryId) {
      ctx.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "Use a category or a split, not both",
      });
    }
    if (!hasSplits && !v.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    }
    if (hasSplits) {
      const sum = v.splits!.reduce((s, l) => s + l.amountMinor, 0);
      if (v.splits!.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "A split needs at least two lines",
        });
      } else if (sum !== v.amountMinor) {
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "Split lines must add up to the total",
        });
      }
    }
  });

const nonNegativeMinor = z
  .number()
  .int("Must be a whole amount")
  .min(0, "Cannot be negative")
  .max(Number.MAX_SAFE_INTEGER)
  .default(0);

/**
 * Transfer between accounts and/or assets. account → account is a transfer; account → asset posts an
 * invest, asset → account a redeem, asset → asset a switch (redeem + invest). The amount is what
 * arrives; the optional fee leaves the source on top of it.
 */
const transferSchema = z
  .object({
    ...base,
    type: z.literal("transfer"),
    fromAccountId: objectId.nullish(),
    toAccountId: objectId.nullish(),
    fromHoldingId: objectId.nullish(),
    toHoldingId: objectId.nullish(),
    /** Required when the two accounts use different currencies. */
    toAmountMinor: amountMinor.nullish(),
    /** Optional fee, charged to the source on top of the amount. */
    feeMinor: nonNegativeMinor,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.fromAccountId) === Boolean(v.fromHoldingId)) {
      ctx.addIssue({
        code: "custom",
        path: ["fromAccountId"],
        message: "Choose where it comes from",
      });
    }
    if (Boolean(v.toAccountId) === Boolean(v.toHoldingId)) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose where it goes" });
    }
    const from = v.fromAccountId ?? v.fromHoldingId;
    const to = v.toAccountId ?? v.toHoldingId;
    if (from && from === to) {
      ctx.addIssue({
        code: "custom",
        path: ["toAccountId"],
        message: "Choose a different account",
      });
    }
    if ((v.fromHoldingId || v.toHoldingId) && v.toAmountMinor) {
      ctx.addIssue({
        code: "custom",
        path: ["toAmountMinor"],
        message: "Moves with an asset use one currency",
      });
    }
  });

const units = z
  .number({ error: "Enter units" })
  .positive("Enter units above zero")
  .finite()
  .refine((u) => Math.abs(u * 1e6 - Math.round(u * 1e6)) < 1e-6, "At most 6 decimals");
/** Price per unit in minor units × 10⁴ (NAV to 4 extra decimals). */
const priceMinorE4 = z.number().int("Invalid price").positive("Enter a price above zero");

const investSchema = z
  .object({
    ...base,
    type: z.literal("invest"),
    fromAccountId: objectId,
    holdingId: objectId,
    feeMinor: nonNegativeMinor,
    units: units.nullish(),
    priceMinorE4: priceMinorE4.nullish(),
  })
  .strict();

/** Redeem by amount (amountMinor) or, for unit-tracked holdings, by units (+ price). */
const redeemSchema = z
  .object({
    ...base,
    type: z.literal("redeem"),
    amountMinor: amountMinor.nullish(),
    toAccountId: objectId,
    holdingId: objectId,
    feeMinor: nonNegativeMinor,
    taxMinor: nonNegativeMinor,
    units: units.nullish(),
    priceMinorE4: priceMinorE4.nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.amountMinor) || Boolean(v.units), {
    path: ["amountMinor"],
    message: "Enter an amount (or units)",
  });

const investmentIncomeSchema = z
  .object({
    ...base,
    type: z.literal("investment_income"),
    holdingId: objectId,
    incomeKind: z.enum(["dividend", "interest", "distribution", "rent", "other"]),
    taxMinor: nonNegativeMinor,
    reinvest: z.boolean().default(false),
    toAccountId: objectId.nullish(),
    units: units.nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.reinvest && !v.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose where it was paid" });
    }
    if (v.taxMinor > v.amountMinor) {
      ctx.addIssue({ code: "custom", path: ["taxMinor"], message: "Tax cannot exceed the amount" });
    }
  });

/** User-entered transactions (Quick add / edit). Adjustments come only from Reconcile. */
export const transactionInputSchema = z.discriminatedUnion("type", [
  incomeSchema,
  expenseSchema,
  transferSchema,
  investSchema,
  redeemSchema,
  investmentIncomeSchema,
]);
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type TransactionData = z.output<typeof transactionInputSchema>;

export const voidTransactionSchema = z
  .object({ reason: z.string().trim().min(1, "Give a reason").max(200) })
  .strict();

export const TRANSACTION_PAGE_SIZE = 50;

/** URL search params of /transactions (all strings; invalid values fall back to defaults). */
export const transactionFiltersSchema = z.object({
  preset: z.enum(DATE_RANGE_PRESETS).catch("this_month").default("this_month"),
  from: dateKey.optional().catch(undefined),
  to: dateKey.optional().catch(undefined),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(
      z.array(
        z.enum([
          "income",
          "expense",
          "transfer",
          "adjustment",
          "invest",
          "redeem",
          "investment_income",
          "opening_balance",
          "debt_payment",
        ]),
      ),
    )
    .catch([]),
  account: objectId.optional().catch(undefined),
  holding: objectId.optional().catch(undefined),
  category: objectId.optional().catch(undefined),
  tag: z.string().trim().toLowerCase().max(30).optional().catch(undefined),
  min: z.coerce.number().int().positive().optional().catch(undefined),
  max: z.coerce.number().int().positive().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  voided: z
    .enum(["1", "0"])
    .optional()
    .catch(undefined)
    .transform((v) => v === "1"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type TransactionFilters = z.output<typeof transactionFiltersSchema>;

export interface TransactionRefDTO {
  id: string;
  name: string;
}

export interface TransactionDTO {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  /** Business date `YYYY-MM-DD` in the user's timezone. */
  date: string;
  amountMinor: number;
  currency: string;
  fromAccount: (TransactionRefDTO & { currency: string }) | null;
  toAccount: (TransactionRefDTO & { currency: string }) | null;
  toAmountMinor: number | null;
  fxRate: number | null;
  category: TransactionRefDTO | null;
  splits: { category: TransactionRefDTO; amountMinor: number; note: string | null }[];
  holding: TransactionRefDTO | null;
  feeMinor: number;
  taxMinor: number;
  units: number | null;
  /** minor units × 10⁴ */
  priceMinorE4: number | null;
  incomeKind: "dividend" | "interest" | "distribution" | "rent" | "other" | null;
  reinvest: boolean | null;
  redemption: {
    costRemovedMinor: number;
    realizedGainMinor: number;
    unitsRemoved: number | null;
  } | null;
  description: string | null;
  counterparty: string | null;
  notes: string | null;
  tags: string[];
  source: SourceKind;
  groupId: string | null;
  voidReason: string | null;
  /** Receipts on this transaction (Phase 11). */
  attachmentCount: number;
  /** True when edit/void must go through the owner (SIP execution, deployment). */
  ownerManaged: boolean;
  editable: boolean;
}
