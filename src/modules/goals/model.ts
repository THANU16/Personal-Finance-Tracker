import { Schema, type Types } from "mongoose";
import { RECURRENCE_UNITS, type Recurrence } from "@/domain/goals";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — goals: target + linked accounts/holdings with a share of each (bp). A repeating goal
// has a per-cycle target; `targetDate` is the current cycle's due date and moves forward one
// period when a cycle is completed or skipped (history in `cycles`).

export const GOAL_STATUSES = ["active", "achieved", "archived"] as const;
export const GOAL_KINDS = ["one_time", "recurring"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const CYCLE_STATUSES = ["completed", "skipped"] as const;

export interface GoalCycle {
  cycleNo: number;
  dueDate: string;
  targetMinor: number;
  /** Progress when the cycle was closed (base currency). */
  currentAtCloseMinor: number;
  status: (typeof CYCLE_STATUSES)[number];
  /** Business date key. */
  closedOn: string;
}

export interface GoalDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: GoalKind;
  /** Per cycle for repeating goals. */
  targetMinor: number;
  /** Repeating goals: the current cycle's due date. */
  targetDate: string;
  recurrence: Recurrence | null;
  /** Current (open) cycle of a repeating goal; 0 for the first. */
  cycleNo: number;
  cycles: GoalCycle[];
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
    kind: { type: String, enum: GOAL_KINDS, required: true, default: "one_time" },
    recurrence: {
      type: new Schema(
        {
          every: intField({ required: true, min: 1, max: 120 }),
          unit: { type: String, enum: RECURRENCE_UNITS, required: true },
          anchorDate: { type: String, required: true },
          anchorCycle: intField({ required: true, min: 0 }),
        },
        { _id: false },
      ),
      default: null,
    },
    cycleNo: intField({ required: true, default: 0, min: 0 }),
    cycles: [
      {
        _id: false,
        cycleNo: intField({ required: true, min: 0 }),
        dueDate: { type: String, required: true },
        targetMinor: intField({ required: true, min: 1 }),
        currentAtCloseMinor: intField({ required: true, min: 0 }),
        status: { type: String, enum: CYCLE_STATUSES, required: true },
        closedOn: { type: String, required: true },
      },
    ],
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
