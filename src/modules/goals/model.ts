import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — goals: target + linked accounts/holdings with a share of each (bp).

export const GOAL_STATUSES = ["active", "achieved", "archived"] as const;

export interface GoalDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  targetMinor: number;
  targetDate: string;
  priority: number;
  icon: string | null;
  notes: string | null;
  links: { kind: "holding" | "account"; refId: Types.ObjectId; shareBp: number }[];
  status: (typeof GOAL_STATUSES)[number];
  expectedReturnBp: number;
  createdAt: Date;
  updatedAt: Date;
}

const goalSchema = new Schema<GoalDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    targetMinor: intField({ required: true, min: 1 }),
    targetDate: { type: String, required: true },
    priority: intField({ required: true, default: 3, min: 1, max: 5 }),
    icon: { type: String, default: null },
    notes: { type: String, default: null },
    links: [
      {
        _id: false,
        kind: { type: String, enum: ["holding", "account"], required: true },
        refId: { type: Schema.Types.ObjectId, required: true },
        shareBp: intField({ required: true, min: 1, max: 10_000 }),
      },
    ],
    status: { type: String, enum: GOAL_STATUSES, required: true, default: "active" },
    expectedReturnBp: intField({ required: true, default: 0, min: 0, max: 5_000 }),
  },
  { timestamps: true },
);
goalSchema.index({ userId: 1, status: 1 });

export const GoalModel = userScopedModel<GoalDoc>("Goal", goalSchema, "goals");
