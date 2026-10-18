import { Schema, type Types } from "mongoose";
import { FREQUENCIES, type Frequency } from "@/domain/recurring";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — recurringRules (docs/04 §11). Dates are business date keys. Never auto-posts.

export const RECURRING_KINDS = ["income", "expense", "transfer", "debt_payment"] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];
export const RECURRING_STATUSES = ["active", "paused", "ended"] as const;

export interface RecurringRuleDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: RecurringKind;
  template: {
    amountMinor: number;
    currency: string;
    fromAccountId: Types.ObjectId | null;
    toAccountId: Types.ObjectId | null;
    categoryId: Types.ObjectId | null;
    debtId: Types.ObjectId | null;
    description: string | null;
    tags: string[];
  };
  frequency: Frequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
  /** null once the rule has ended. */
  nextDueDate: string | null;
  reminderDaysBefore: number;
  isVariableAmount: boolean;
  status: (typeof RECURRING_STATUSES)[number];
  lastConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ruleSchema = new Schema<RecurringRuleDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: RECURRING_KINDS, required: true },
    template: {
      amountMinor: intField({ required: true, min: 1 }),
      currency: { type: String, required: true },
      fromAccountId: { type: Schema.Types.ObjectId, default: null },
      toAccountId: { type: Schema.Types.ObjectId, default: null },
      categoryId: { type: Schema.Types.ObjectId, default: null },
      debtId: { type: Schema.Types.ObjectId, default: null },
      description: { type: String, default: null },
      tags: { type: [String], default: [] },
    },
    frequency: { type: String, enum: FREQUENCIES, required: true },
    interval: intField({ required: true, default: 1, min: 1, max: 60 }),
    dayOfMonth: intField({ default: null, min: 1, max: 31 }),
    weekday: intField({ default: null, min: 0, max: 6 }),
    monthOfYear: intField({ default: null, min: 1, max: 12 }),
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    nextDueDate: { type: String, default: null },
    reminderDaysBefore: intField({ required: true, default: 2, min: 0, max: 60 }),
    isVariableAmount: { type: Boolean, required: true, default: false },
    status: { type: String, enum: RECURRING_STATUSES, required: true, default: "active" },
    lastConfirmedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
ruleSchema.index({ userId: 1, status: 1, nextDueDate: 1 });

export const RecurringRuleModel = userScopedModel<RecurringRuleDoc>(
  "RecurringRule",
  ruleSchema,
  "recurringRules",
);
