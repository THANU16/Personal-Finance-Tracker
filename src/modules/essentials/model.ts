import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 — insurancePolicies (Essentials, docs/04 §13). Dates are business date keys.

export const POLICY_TYPES = [
  "life",
  "health",
  "critical_illness",
  "vehicle",
  "home",
  "other",
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];
export const PREMIUM_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type PremiumFrequency = (typeof PREMIUM_FREQUENCIES)[number];
export const POLICY_STATUSES = ["active", "lapsed"] as const;

export interface InsurancePolicyDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: PolicyType;
  provider: string;
  policyNumberLast4: string | null;
  coverMinor: number;
  premiumMinor: number;
  premiumFrequency: PremiumFrequency;
  startDate: string;
  renewalDate: string;
  nominee: string | null;
  notes: string | null;
  status: (typeof POLICY_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

const policySchema = new Schema<InsurancePolicyDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: POLICY_TYPES, required: true },
    provider: { type: String, required: true, trim: true },
    policyNumberLast4: { type: String, default: null },
    coverMinor: intField({ required: true, min: 0 }),
    premiumMinor: intField({ required: true, min: 0 }),
    premiumFrequency: { type: String, enum: PREMIUM_FREQUENCIES, required: true },
    startDate: { type: String, required: true },
    renewalDate: { type: String, required: true },
    nominee: { type: String, default: null },
    notes: { type: String, default: null },
    status: { type: String, enum: POLICY_STATUSES, required: true, default: "active" },
  },
  { timestamps: true },
);
policySchema.index({ userId: 1, status: 1 });

export const InsurancePolicyModel = userScopedModel<InsurancePolicyDoc>(
  "InsurancePolicy",
  policySchema,
  "insurancePolicies",
);
