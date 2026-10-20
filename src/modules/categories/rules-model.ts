import { Schema, type Types } from "mongoose";
import {
  RULE_FIELDS,
  RULE_OPERATORS,
  type RuleField,
  type RuleOperator,
} from "@/domain/category-rules";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 categoryRules — CSV import auto-categorisation (Phase 11).

export interface CategoryRuleDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  matchField: RuleField;
  operator: RuleOperator;
  pattern: string;
  categoryId: Types.ObjectId;
  /** Lower runs first. */
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

const ruleSchema = new Schema<CategoryRuleDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    matchField: { type: String, enum: RULE_FIELDS, required: true },
    operator: { type: String, enum: RULE_OPERATORS, required: true },
    pattern: { type: String, required: true, trim: true, maxlength: 200 },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    priority: intField({ required: true, default: 100, min: 0, max: 10_000 }),
  },
  { timestamps: true },
);
ruleSchema.index({ userId: 1, priority: 1 });

export const CategoryRuleModel = userScopedModel<CategoryRuleDoc>(
  "CategoryRule",
  ruleSchema,
  "categoryRules",
);
