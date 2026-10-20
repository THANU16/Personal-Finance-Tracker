import { Schema, type Types } from "mongoose";
import type { MonthlyReview } from "@/domain/reports";
import { userScopedModel } from "@/server/db/model";

// Monthly review (Phase 11, MOD-DOCS): generated on the 1st by the daily job for the previous
// month; one per user per month. A cache of ledger numbers at generation time.

export interface MonthlyReviewDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** `YYYY-MM`. */
  month: string;
  generatedAt: Date;
  data: MonthlyReview;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<MonthlyReviewDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    generatedAt: { type: Date, required: true },
    data: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, minimize: false },
);
reviewSchema.index({ userId: 1, month: 1 }, { unique: true });

export const MonthlyReviewModel = userScopedModel<MonthlyReviewDoc>(
  "MonthlyReview",
  reviewSchema,
  "monthlyReviews",
);
