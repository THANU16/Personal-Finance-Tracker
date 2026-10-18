import { Schema, type Types } from "mongoose";
import { allocationTreeSchema, type AllocationTreeDoc } from "@/modules/allocation/model";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — opportunityFund (one per user), marketLevels, opportunityDeployments (docs/04 §15).
// The reference high and triggered rules are replayed from the levels; only the cycle start and the
// fund balance at that moment are stored (they cannot be rebuilt later).

export const ALLOCATION_SOURCES = ["target", "custom"] as const;
export type AllocationSource = (typeof ALLOCATION_SOURCES)[number];

export interface OpportunityFundDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  benchmarkName: string;
  targetSizeMinor: number | null;
  rules: { drawdownBp: number; deployPercentBp: number }[];
  allocationSource: AllocationSource;
  allocation: AllocationTreeDoc[];
  /** Optional default source for deployments (any account holding opportunity money can be used). */
  defaultSourceAccountId: Types.ObjectId | null;
  cycle: { startedAt: string | null; fundBalanceAtStartMinor: number };
  createdAt: Date;
  updatedAt: Date;
}

const fundSchema = new Schema<OpportunityFundDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    benchmarkName: { type: String, required: true, trim: true, default: "ASPI" },
    targetSizeMinor: intField({ default: null, min: 0 }),
    rules: [
      {
        _id: false,
        drawdownBp: intField({ required: true, min: 1, max: 10_000 }),
        deployPercentBp: intField({ required: true, min: 1, max: 10_000 }),
      },
    ],
    allocationSource: { type: String, enum: ALLOCATION_SOURCES, required: true, default: "target" },
    allocation: { type: [allocationTreeSchema], default: [] },
    defaultSourceAccountId: { type: Schema.Types.ObjectId, default: null },
    cycle: {
      /** Business date of the level that opened the cycle. */
      startedAt: { type: String, default: null },
      fundBalanceAtStartMinor: intField({ required: true, default: 0, min: 0 }),
    },
  },
  { timestamps: true },
);
fundSchema.index({ userId: 1 }, { unique: true });

export const OpportunityFundModel = userScopedModel<OpportunityFundDoc>(
  "OpportunityFund",
  fundSchema,
  "opportunityFunds",
);

export interface MarketLevelDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  benchmarkName: string;
  /** Business date `YYYY-MM-DD` (a level is a daily close, not an instant). */
  date: string;
  level: number;
  note: string | null;
  createdAt: Date;
}

const levelSchema = new Schema<MarketLevelDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    benchmarkName: { type: String, required: true },
    date: { type: String, required: true },
    level: { type: Number, required: true, min: 0 },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
levelSchema.index({ userId: 1, benchmarkName: 1, date: 1 }, { unique: true });

export const MarketLevelModel = userScopedModel<MarketLevelDoc>(
  "MarketLevel",
  levelSchema,
  "marketLevels",
);

export interface DeploymentLineDoc {
  assetClassId: Types.ObjectId;
  holdingId: Types.ObjectId;
  amountMinor: number;
  feeMinor: number;
  transactionId: Types.ObjectId | null;
}

export interface OpportunityDeploymentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Business date. */
  date: string;
  amountMinor: number;
  currency: string;
  sourceAccountId: Types.ObjectId;
  ruleIdx: number | null;
  drawdownBpAtDeploy: number;
  marketLevel: number | null;
  /** Cycle the deployment counts towards (deployed this cycle). */
  cycleStartedAt: string | null;
  allocationUsed: AllocationTreeDoc[];
  lines: DeploymentLineDoc[];
  /** Opportunity earmark removed from the source account (restored on undo). */
  earmarkReducedMinor: number;
  groupId: Types.ObjectId;
  notes: string | null;
  status: "posted" | "undone";
  undoneAt: Date | null;
  createdAt: Date;
}

const deploymentSchema = new Schema<OpportunityDeploymentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    amountMinor: intField({ required: true, min: 1 }),
    currency: { type: String, required: true },
    sourceAccountId: { type: Schema.Types.ObjectId, required: true },
    ruleIdx: { type: Number, default: null },
    drawdownBpAtDeploy: intField({ required: true, default: 0, min: 0 }),
    marketLevel: { type: Number, default: null },
    cycleStartedAt: { type: String, default: null },
    allocationUsed: { type: [allocationTreeSchema], default: [] },
    lines: [
      {
        _id: false,
        assetClassId: { type: Schema.Types.ObjectId, required: true },
        holdingId: { type: Schema.Types.ObjectId, required: true },
        amountMinor: intField({ required: true, min: 1 }),
        feeMinor: intField({ required: true, default: 0, min: 0 }),
        transactionId: { type: Schema.Types.ObjectId, default: null },
      },
    ],
    earmarkReducedMinor: intField({ required: true, default: 0, min: 0 }),
    groupId: { type: Schema.Types.ObjectId, required: true },
    notes: { type: String, default: null },
    status: { type: String, enum: ["posted", "undone"], required: true, default: "posted" },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
deploymentSchema.index({ userId: 1, date: -1 });

export const OpportunityDeploymentModel = userScopedModel<OpportunityDeploymentDoc>(
  "OpportunityDeployment",
  deploymentSchema,
  "opportunityDeployments",
);
