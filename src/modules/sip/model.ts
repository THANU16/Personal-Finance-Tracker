import { Schema, type Types } from "mongoose";
import {
  EXECUTION_STATUSES,
  MISSED_POLICIES,
  SIP_FREQUENCIES,
  type ExecutionStatus,
  type MissedPolicy,
  type SipFrequency,
} from "@/domain/sip";
import { allocationTreeSchema, type AllocationTreeDoc } from "@/modules/allocation/model";
import {
  ALLOCATION_SOURCES,
  PLAN_STATUSES,
  type AllocationSource,
  type PlanStatus,
} from "@/modules/sip/constants";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — sipPlans, sipPlanVersions, sipExecutions (docs/04 §7).

export interface SipPlanDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  status: PlanStatus;
  /** Base amount of the current version (cache for lists; versions are the truth). */
  amountMinor: number;
  currency: string;
  frequency: SipFrequency;
  dayOfMonth: number | null;
  weekday: number | null;
  sourceAccountId: Types.ObjectId;
  startDate: Date;
  endDate: Date | null;
  stepUp: { percentBp: number; everyMonths: number } | null;
  missedPolicy: MissedPolicy;
  graceDays: number;
  useDriftTilt: boolean;
  currentVersion: number;
  notes: string | null;
  /** Generation never back-fills paused periods: due dates before this are not generated. */
  resumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<SipPlanDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    status: { type: String, enum: PLAN_STATUSES, required: true, default: "active" },
    amountMinor: intField({ required: true, min: 1 }),
    currency: { type: String, required: true },
    frequency: { type: String, enum: SIP_FREQUENCIES, required: true },
    dayOfMonth: intField({ default: null, min: 1, max: 31 }),
    weekday: intField({ default: null, min: 0, max: 6 }),
    sourceAccountId: { type: Schema.Types.ObjectId, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    stepUp: {
      type: new Schema(
        {
          percentBp: intField({ required: true, min: 1, max: 10_000 }),
          everyMonths: intField({ required: true, min: 1, max: 120 }),
        },
        { _id: false },
      ),
      default: null,
    },
    missedPolicy: { type: String, enum: MISSED_POLICIES, required: true, default: "skip" },
    graceDays: intField({ required: true, default: 7, min: 0, max: 60 }),
    useDriftTilt: { type: Boolean, required: true, default: false },
    currentVersion: intField({ required: true, default: 1, min: 1 }),
    notes: { type: String, default: null, maxlength: 1000 },
    resumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
planSchema.index({ userId: 1, status: 1 });

export const SipPlanModel = userScopedModel<SipPlanDoc>("SipPlan", planSchema, "sipPlans");

export interface SipPlanVersionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  version: number;
  effectiveFrom: Date;
  amountMinor: number;
  allocationSource: AllocationSource;
  allocation: AllocationTreeDoc[];
  createdAt: Date;
}

const versionSchema = new Schema<SipPlanVersionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    planId: { type: Schema.Types.ObjectId, required: true },
    version: intField({ required: true, min: 1 }),
    effectiveFrom: { type: Date, required: true },
    amountMinor: intField({ required: true, min: 1 }),
    allocationSource: { type: String, enum: ALLOCATION_SOURCES, required: true, default: "target" },
    allocation: { type: [allocationTreeSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
versionSchema.index({ userId: 1, planId: 1, version: 1 }, { unique: true });

export const SipPlanVersionModel = userScopedModel<SipPlanVersionDoc>(
  "SipPlanVersion",
  versionSchema,
  "sipPlanVersions",
);

export interface ExecutionLineDoc {
  assetClassId: Types.ObjectId;
  holdingId: Types.ObjectId | null;
  plannedMinor: number;
  actualMinor: number;
  feeMinor: number;
  units: number | null;
  priceMinorE4: number | null;
  transactionId: Types.ObjectId | null;
}

export interface SipExecutionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  planVersion: number;
  periodKey: string;
  dueDate: Date;
  status: ExecutionStatus;
  plannedTotalMinor: number;
  carryInMinor: number;
  actualTotalMinor: number;
  executedAt: Date | null;
  skipReason: string | null;
  lines: ExecutionLineDoc[];
  groupId: Types.ObjectId | null;
  onTime: boolean | null;
  allocationUsed: AllocationTreeDoc[];
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<ExecutionLineDoc>(
  {
    assetClassId: { type: Schema.Types.ObjectId, required: true },
    holdingId: { type: Schema.Types.ObjectId, default: null },
    plannedMinor: intField({ required: true, min: 0 }),
    actualMinor: intField({ required: true, default: 0, min: 0 }),
    feeMinor: intField({ required: true, default: 0, min: 0 }),
    units: { type: Number, default: null },
    priceMinorE4: intField({ default: null, min: 1 }),
    transactionId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const executionSchema = new Schema<SipExecutionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    planId: { type: Schema.Types.ObjectId, required: true },
    planVersion: intField({ required: true, min: 1 }),
    periodKey: { type: String, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: EXECUTION_STATUSES, required: true, default: "due" },
    plannedTotalMinor: intField({ required: true, min: 0 }),
    carryInMinor: intField({ required: true, default: 0, min: 0 }),
    actualTotalMinor: intField({ required: true, default: 0, min: 0 }),
    executedAt: { type: Date, default: null },
    skipReason: { type: String, default: null, maxlength: 200 },
    lines: { type: [lineSchema], default: [] },
    groupId: { type: Schema.Types.ObjectId, default: null },
    onTime: { type: Boolean, default: null },
    allocationUsed: { type: [allocationTreeSchema], default: [] },
  },
  { timestamps: true },
);
executionSchema.index({ userId: 1, planId: 1, periodKey: 1 }, { unique: true });
executionSchema.index({ userId: 1, status: 1, dueDate: 1 });

export const SipExecutionModel = userScopedModel<SipExecutionDoc>(
  "SipExecution",
  executionSchema,
  "sipExecutions",
);
