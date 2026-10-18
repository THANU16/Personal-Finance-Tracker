import { z } from "zod";
import { FREQUENCIES } from "@/domain/recurring";
import { dateKey } from "@/modules/accounts/schemas";
import { RECURRING_KINDS } from "@/modules/recurring/model";

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

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(60),
    kind: z.enum(RECURRING_KINDS),
    amountMinor,
    fromAccountId: objectId.nullish(),
    toAccountId: objectId.nullish(),
    categoryId: objectId.nullish(),
    debtId: objectId.nullish(),
    description: text(200),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]),
    frequency: z.enum(FREQUENCIES),
    interval: z.number().int().min(1).max(60).default(1),
    dayOfMonth: z.number().int().min(1, "Day 1–31").max(31, "Day 1–31").nullish(),
    weekday: z.number().int().min(0).max(6).nullish(),
    monthOfYear: z.number().int().min(1).max(12).nullish(),
    startDate: dateKey,
    endDate: dateKey.nullish(),
    reminderDaysBefore: z.number().int().min(0).max(60).default(2),
    isVariableAmount: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = (
      field: "fromAccountId" | "toAccountId" | "categoryId" | "debtId",
      message: string,
    ) => {
      if (!v[field]) ctx.addIssue({ code: "custom", path: [field], message });
    };
    if (v.kind === "income") {
      need("toAccountId", "Choose the account it arrives in");
      need("categoryId", "Choose a category");
    }
    if (v.kind === "expense") {
      need("fromAccountId", "Choose the account it is paid from");
      need("categoryId", "Choose a category");
    }
    if (v.kind === "transfer") {
      need("fromAccountId", "Choose where it comes from");
      need("toAccountId", "Choose where it goes");
      if (v.fromAccountId && v.fromAccountId === v.toAccountId) {
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "Choose a different account",
        });
      }
    }
    if (v.kind === "debt_payment") {
      need("debtId", "Choose the loan");
      need("fromAccountId", "Choose the account it is paid from");
    }
    if (v.frequency === "weekly" && v.weekday == null) {
      ctx.addIssue({ code: "custom", path: ["weekday"], message: "Choose a weekday" });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Ends before it starts" });
    }
  });
export type RuleInput = z.input<typeof ruleInputSchema>;

export const confirmRuleSchema = z
  .object({
    /** The due date being confirmed (must equal the rule's next due date: posts once). */
    dueDate: dateKey,
    /** Defaults to the due date. */
    date: dateKey.nullish(),
    amountMinor: amountMinor.nullish(),
    confirmOpportunity: z.boolean().optional(),
    confirmEmergency: z.boolean().optional(),
  })
  .strict();

export const skipRuleSchema = z.object({ dueDate: dateKey }).strict();

export interface RuleDTO {
  id: string;
  name: string;
  kind: (typeof RECURRING_KINDS)[number];
  amountMinor: number;
  currency: string;
  fromAccount: { id: string; name: string } | null;
  toAccount: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  debt: { id: string; name: string } | null;
  description: string | null;
  tags: string[];
  frequency: (typeof FREQUENCIES)[number];
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
  nextDueDate: string | null;
  reminderDaysBefore: number;
  isVariableAmount: boolean;
  status: "active" | "paused" | "ended";
  /** Next due within the reminder window (or overdue). */
  dueSoon: boolean;
  overdue: boolean;
}

/** Quick add "from template" (income/expense/transfer rules). */
export interface TemplateDTO {
  id: string;
  name: string;
  kind: "income" | "expense" | "transfer";
  amountMinor: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  description: string | null;
  tags: string[];
}
