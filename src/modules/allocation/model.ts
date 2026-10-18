import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — targetAllocations (one per user) and targetAllocationHistory.

export interface AllocationTreeDoc {
  assetClassId: Types.ObjectId;
  percentBp: number;
  assets: { holdingId: Types.ObjectId; percentBp: number }[];
}

/** Shared sub-schema for allocation trees (target, SIP versions/executions, opportunity fund). */
export const allocationTreeSchema = new Schema<AllocationTreeDoc>(
  {
    assetClassId: { type: Schema.Types.ObjectId, required: true },
    percentBp: intField({ required: true, min: 0, max: 10_000 }),
    assets: [
      {
        _id: false,
        holdingId: { type: Schema.Types.ObjectId, required: true },
        percentBp: intField({ required: true, min: 0, max: 10_000 }),
      },
    ],
  },
  { _id: false },
);

export interface TargetAllocationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  allocation: AllocationTreeDoc[];
  /** Drift alert threshold for rebalancing (docs/04 §8). */
  thresholdBp: number;
  createdAt: Date;
  updatedAt: Date;
}

const targetSchema = new Schema<TargetAllocationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    allocation: { type: [allocationTreeSchema], default: [] },
    thresholdBp: intField({ required: true, default: 500, min: 0, max: 10_000 }),
  },
  { timestamps: true },
);
targetSchema.index({ userId: 1 }, { unique: true });

export const TargetAllocationModel = userScopedModel<TargetAllocationDoc>(
  "TargetAllocation",
  targetSchema,
  "targetAllocations",
);

export interface TargetAllocationHistoryDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  allocation: AllocationTreeDoc[];
  thresholdBp: number;
  savedAt: Date;
  note: string | null;
}

const historySchema = new Schema<TargetAllocationHistoryDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  allocation: { type: [allocationTreeSchema], default: [] },
  thresholdBp: intField({ required: true }),
  savedAt: { type: Date, required: true, default: () => new Date() },
  note: { type: String, default: null, maxlength: 200 },
});
historySchema.index({ userId: 1, savedAt: -1 });

export const TargetAllocationHistoryModel = userScopedModel<TargetAllocationHistoryDoc>(
  "TargetAllocationHistory",
  historySchema,
  "targetAllocationHistory",
);
