import { z } from "zod";
import { ACCOUNT_TYPES, type AccountType } from "@/domain/accounts";
import { isDateKey } from "@/domain/dates";
import { minorUnitDigits } from "@/domain/money";

export const dateKey = z.string().refine(isDateKey, "Enter a valid date");
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
  .refine((c) => {
    try {
      minorUnitDigits(c);
      return true;
    } catch {
      return false;
    }
  }, "Unknown currency");
const signedMinor = z
  .number()
  .int("Must be a whole amount")
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullable()
    .transform((v) => (v ? v : null));

export const creditCardSchema = z
  .object({
    limitMinor: z.number().int("Must be a whole amount").min(0, "Cannot be negative"),
    statementDay: z.number().int().min(1, "Day 1–31").max(31, "Day 1–31"),
    dueDay: z.number().int().min(1, "Day 1–31").max(31, "Day 1–31"),
  })
  .strict();

const accountFields = {
  name: z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters"),
  currency,
  institution: optionalText(80),
  notes: optionalText(500),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  /** Signed. Liabilities are negative (the form asks for the amount owed and negates it). */
  openingBalanceMinor: signedMinor,
  openingDate: dateKey,
  includeInNetWorth: z.boolean(),
  countsTowardEmergencyFund: z.boolean(),
  creditCard: creditCardSchema.nullable(),
  counterparty: optionalText(80),
};

export const createAccountSchema = z
  .object({
    ...accountFields,
    type: z.enum(ACCOUNT_TYPES),
    institution: accountFields.institution.default(null),
    notes: accountFields.notes.default(null),
    color: accountFields.color.default(null),
    includeInNetWorth: accountFields.includeInNetWorth.default(true),
    countsTowardEmergencyFund: accountFields.countsTowardEmergencyFund.default(false),
    creditCard: accountFields.creditCard.default(null),
    counterparty: accountFields.counterparty.default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "credit_card" && !v.creditCard) {
      ctx.addIssue({
        code: "custom",
        path: ["creditCard"],
        message: "Enter the card's limit and days",
      });
    }
    if (v.type !== "credit_card" && v.creditCard) {
      ctx.addIssue({
        code: "custom",
        path: ["creditCard"],
        message: "Only credit cards have a limit",
      });
    }
  });
export type CreateAccountInput = z.input<typeof createAccountSchema>;

export const updateAccountSchema = z.object(accountFields).partial().strict();
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export const reconcileAccountSchema = z
  .object({ realBalanceMinor: signedMinor, date: dateKey })
  .strict();
export type ReconcileAccountInput = z.input<typeof reconcileAccountSchema>;

export const archiveAccountSchema = z.object({ force: z.boolean().default(false) }).strict();

export interface AccountDTO {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  institution: string | null;
  notes: string | null;
  color: string | null;
  openingBalanceMinor: number;
  openingDate: string;
  includeInNetWorth: boolean;
  countsTowardEmergencyFund: boolean;
  creditCard: { limitMinor: number; statementDay: number; dueDay: number } | null;
  counterparty: string | null;
  balanceMinor: number;
  lastTransactionAt: string | null;
  archived: boolean;
  /** credit_card only */
  card: { outstandingMinor: number; utilisationBp: number | null; nextDueDate: string } | null;
}
