import { z } from "zod";
import { ACCOUNT_TYPES } from "@/domain/accounts";
import { dateKey } from "@/modules/accounts/schemas";
import { INSTRUMENT_TYPES, LIQUIDITY } from "@/modules/holdings/constants";

// docs/07 §3 — the wizard state saved on the draft batch. Refs to existing records are ids; items to
// create are declared inline and created at commit (inside the import transaction).

const objectId = z.string().regex(/^[0-9a-f]{24}$/i, "Choose an item");
const name = z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters");
const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");

export const newAccountSchema = z.object({
  name,
  type: z.enum(ACCOUNT_TYPES),
  currency,
});

export const newHoldingSchema = z.object({
  name,
  assetClassId: objectId,
  instrumentType: z.enum(INSTRUMENT_TYPES).refine((t) => t !== "fd", {
    message: "Fixed deposits cannot be imported (their value is calculated); choose another type",
  }),
  liquidity: z.enum(LIQUIDITY),
});

export const accountChoiceSchema = z.discriminatedUnion("treatAs", [
  z.object({
    treatAs: z.literal("account"),
    existingId: objectId.nullable(),
    create: newAccountSchema.nullable(),
  }),
  z.object({
    treatAs: z.literal("holding"),
    existingId: objectId.nullable(),
    create: newHoldingSchema.nullable(),
  }),
  z.object({ treatAs: z.literal("ignore") }),
  z.object({ treatAs: z.literal("merge"), into: z.string().min(1) }),
]);
export type AccountChoice = z.infer<typeof accountChoiceSchema>;

export const categoryChoiceSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("existing"), existingId: objectId }),
  z.object({ action: z.literal("create"), name, isEssential: z.boolean() }),
  z.object({ action: z.literal("merge"), into: z.string().min(1) }),
  z.object({ action: z.literal("uncategorised") }),
  /** Not decided yet (the step's Next stays disabled). */
  z.object({ action: z.literal("unset") }),
]);
export type CategoryChoice = z.infer<typeof categoryChoiceSchema>;

export const openingSchema = z.object({
  /** New accounts: opening date (default: first row). Existing accounts: move the opening date. */
  date: dateKey.nullable(),
  /** New accounts only; signed minor units (default 0, Money Manager starts from zero). */
  balanceMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});

export const wizardStateSchema = z.object({
  accounts: z.record(z.string(), accountChoiceSchema),
  expenseCategories: z.record(z.string(), categoryChoiceSchema),
  incomeCategories: z.record(z.string(), categoryChoiceSchema),
  skipRowIds: z.array(z.string()).max(100_000),
  detachFeeIds: z.array(z.string()).max(100_000),
  /** Keyed by target ref (account id, or `new:<money manager key>`). */
  openings: z.record(z.string(), openingSchema),
});
export type WizardState = z.infer<typeof wizardStateSchema>;

export const saveMappingSchema = z.object({
  batchId: objectId,
  state: wizardStateSchema,
});

export const batchIdSchema = z.object({ batchId: objectId });

export const commitSchema = z.object({
  batchId: objectId,
  confirmReviewed: z.literal(true, { message: "Tick “I reviewed the mapping”" }),
});

export const undoSchema = z.object({
  batchId: objectId,
  archiveCreated: z.boolean(),
});

// ----------------------------------------------------------------------------------- DTOs

export interface WizardAccountRow {
  key: string;
  name: string;
  rows: number;
  inMinor: number;
  outMinor: number;
  firstDate: string;
  lastDate: string;
  currency: string;
  hasDifference: boolean;
  samples: { date: string; type: string; category: string; amountMinor: number; note: string }[];
}

export interface WizardCategoryRow {
  key: string;
  name: string;
  icon: string | null;
  parentKey: string | null;
  rows: number;
  totalMinor: number;
}

export interface WizardRowRef {
  id: string;
  date: string;
  account: string;
  category: string;
  type: string;
  amountMinor: number;
  note: string;
  description: string;
}

export interface WizardData {
  batchId: string;
  status: "draft" | "previewed" | "imported" | "reverted";
  files: { name: string; sheet: string; rows: number; from: string | null; to: string | null }[];
  warnings: string[];
  baseCurrency: string;
  counts: { total: number; alreadyImported: number; toImport: number };
  accounts: WizardAccountRow[];
  expenseCategories: WizardCategoryRow[];
  incomeCategories: WizardCategoryRow[];
  hints: { expense: { from: string; to: string }[]; income: { from: string; to: string }[] };
  transfers: { out: WizardRowRef; in: WizardRowRef; fee: WizardRowRef | null }[];
  standaloneFees: WizardRowRef[];
  ambiguousFeeIds: string[];
  differences: WizardRowRef[];
  problems: { row: WizardRowRef; reason: string }[];
  state: WizardState;
  options: {
    accounts: { id: string; name: string; type: string; currency: string; openingDate: string }[];
    holdings: { id: string; name: string; currency: string; isFd: boolean }[];
    expenseCategories: { id: string; label: string }[];
    incomeCategories: { id: string; label: string }[];
    assetClasses: { id: string; name: string }[];
  };
}

export interface PreviewLine {
  ref: string;
  name: string;
  isNew: boolean;
  /** First imported row on this account. */
  firstDate: string | null;
  /** New accounts: the opening date that will be used; existing: their current opening date. */
  openingDate: string | null;
  openingBalanceMinor: number;
  wealthTrackMinor: number;
  moneyManagerMinor: number;
  currency: string;
}

export interface PreviewData {
  batchId: string;
  blockers: string[];
  warnings: string[];
  create: { accounts: string[]; holdings: string[]; categories: string[] };
  ops: Record<string, number>;
  skipped: { rowIds: string[]; reason: string }[];
  balances: PreviewLine[];
  holdings: { ref: string; name: string; valueMinor: number }[];
  monthly: {
    month: string;
    sheetIncomeMinor: number;
    sheetExpenseMinor: number;
    incomeMinor: number;
    expenseMinor: number;
  }[];
}

export interface ImportResult {
  batchId: string;
  transactions: number;
  valuations: number;
  created: { accounts: number; categories: number; holdings: number };
}
