import { Schema, type Types } from "mongoose";
import { BUCKETS, EARMARK_MODES, type Bucket, type EarmarkMode } from "@/domain/earmarks";
import { intField, userScopedModel } from "@/server/db/model";

// Holding earmarks (owner request): emergency / opportunity money held inside an asset, so it keeps
// earning until it is needed. Same rules as account earmarks (docs/04 §20) on the holding's value.
// Own collection: the account earmark index ({userId, bucket, accountId} unique) cannot hold them.
export interface HoldingEarmarkDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  holdingId: Types.ObjectId;
  bucket: Bucket;
  mode: EarmarkMode;
  /** fixed mode */
  amountMinor: number | null;
  /** percent mode, of the holding's current value */
  percentBp: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const holdingEarmarkSchema = new Schema<HoldingEarmarkDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    holdingId: { type: Schema.Types.ObjectId, required: true },
    bucket: { type: String, enum: BUCKETS, required: true },
    mode: { type: String, enum: EARMARK_MODES, required: true },
    amountMinor: intField({ default: null, min: 0 }),
    percentBp: intField({ default: null, min: 1, max: 10_000 }),
    note: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);
holdingEarmarkSchema.index({ userId: 1, holdingId: 1, bucket: 1 }, { unique: true });

export const HoldingEarmarkModel = userScopedModel<HoldingEarmarkDoc>(
  "HoldingEarmark",
  holdingEarmarkSchema,
  "holdingEarmarks",
);
