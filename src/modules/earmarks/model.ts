import { Schema, type Types } from "mongoose";
import { BUCKETS, EARMARK_MODES, type Bucket, type EarmarkMode } from "@/domain/earmarks";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — earmarks (docs/04 §20). One per bucket per account; only earmarkable accounts.
export interface EarmarkDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  bucket: Bucket;
  accountId: Types.ObjectId;
  mode: EarmarkMode;
  /** fixed mode */
  amountMinor: number | null;
  /** percent mode, of the account balance */
  percentBp: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const earmarkSchema = new Schema<EarmarkDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    bucket: { type: String, enum: BUCKETS, required: true },
    accountId: { type: Schema.Types.ObjectId, required: true },
    mode: { type: String, enum: EARMARK_MODES, required: true },
    amountMinor: intField({ default: null, min: 0 }),
    percentBp: intField({ default: null, min: 1, max: 10_000 }),
    note: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

earmarkSchema.index({ userId: 1, accountId: 1 });
earmarkSchema.index({ userId: 1, bucket: 1, accountId: 1 }, { unique: true });

export const EarmarkModel = userScopedModel<EarmarkDoc>("Earmark", earmarkSchema, "earmarks");
