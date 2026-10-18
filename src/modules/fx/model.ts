import { Schema, type Types } from "mongoose";
import { userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — fxRates. `rate` = quote units per 1 base unit (major units).
export interface FxRateDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Business date at local midnight (UTC instant), like transaction dates. */
  date: Date;
  base: string;
  quote: string;
  rate: number;
  source: "manual";
  createdAt: Date;
  updatedAt: Date;
}

const fxRateSchema = new Schema<FxRateDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },
    base: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    quote: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    rate: { type: Number, required: true, min: 0 },
    source: { type: String, enum: ["manual"], required: true, default: "manual" },
  },
  { timestamps: true },
);

fxRateSchema.index({ userId: 1, base: 1, quote: 1, date: -1 }, { unique: true });

export const FxRateModel = userScopedModel<FxRateDoc>("FxRate", fxRateSchema, "fxRates");
