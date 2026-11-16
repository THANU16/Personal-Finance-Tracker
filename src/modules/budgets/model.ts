import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — budgets: one amount per expense category per month (base currency).

export interface BudgetDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  month: string;
  categoryId: Types.ObjectId;
  /** 0 only on a skip row. */
  amountMinor: number;
  /** Stored for later (carry unspent into next month); not applied yet. */
  rollover: boolean;
  /** Owner request: no budget this month although a repeating budget covers it. */
  skip: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const budgetSchema = new Schema<BudgetDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    amountMinor: intField({ required: true, min: 0 }),
    rollover: { type: Boolean, required: true, default: false },
    skip: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
budgetSchema.index({ userId: 1, month: 1, categoryId: 1 }, { unique: true });

export const BudgetModel = userScopedModel<BudgetDoc>("Budget", budgetSchema, "budgets");

// docs/03 — budgetRules (owner request): a repeating budget — every month from `fromMonth` until
// `untilMonth` (null = no end). A month's own budget row overrides it for that month.
export interface BudgetRuleDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  categoryId: Types.ObjectId;
  amountMinor: number;
  fromMonth: string;
  untilMonth: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const budgetRuleSchema = new Schema<BudgetRuleDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    amountMinor: intField({ required: true, min: 1 }),
    fromMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    untilMonth: { type: String, default: null, match: /^\d{4}-\d{2}$/ },
  },
  { timestamps: true },
);
budgetRuleSchema.index({ userId: 1, categoryId: 1, fromMonth: 1 }, { unique: true });

export const BudgetRuleModel = userScopedModel<BudgetRuleDoc>(
  "BudgetRule",
  budgetRuleSchema,
  "budgetRules",
);
