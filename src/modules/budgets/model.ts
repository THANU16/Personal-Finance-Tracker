import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — budgets: one amount per expense category per month (base currency).

export interface BudgetDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  month: string;
  categoryId: Types.ObjectId;
  amountMinor: number;
  /** Stored for later (carry unspent into next month); not applied yet. */
  rollover: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const budgetSchema = new Schema<BudgetDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    amountMinor: intField({ required: true, min: 1 }),
    rollover: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
budgetSchema.index({ userId: 1, month: 1, categoryId: 1 }, { unique: true });

export const BudgetModel = userScopedModel<BudgetDoc>("Budget", budgetSchema, "budgets");
