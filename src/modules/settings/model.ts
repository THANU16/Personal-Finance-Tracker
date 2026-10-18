import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — settings (one per user)
export interface SettingsDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  baseCurrency: string;
  timezone: string;
  locale: string;
  staleDays: number;
  bigChangeThresholdBp: number;
  driftThresholdBp: number;
  emergencyMonths: number;
  lifeCoverIncomeMultiple: number;
  healthCoverTargetMinor: number | null;
  minBalanceWarningMinor: number;
  hideAmounts: boolean;
  notify: { email: boolean; inApp: boolean; dailyHourLocal: number };
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<SettingsDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    baseCurrency: { type: String, required: true, default: "LKR" },
    timezone: { type: String, required: true, default: "Asia/Colombo" },
    locale: { type: String, required: true, default: "en-LK" },
    staleDays: intField({ required: true, default: 30, min: 1 }),
    bigChangeThresholdBp: intField({ required: true, default: 2000, min: 0 }),
    driftThresholdBp: intField({ required: true, default: 500, min: 0 }),
    emergencyMonths: intField({ required: true, default: 6, min: 0 }),
    lifeCoverIncomeMultiple: intField({ required: true, default: 10, min: 0 }),
    healthCoverTargetMinor: intField({ default: null, min: 0 }),
    minBalanceWarningMinor: intField({ required: true, default: 0, min: 0 }),
    hideAmounts: { type: Boolean, required: true, default: false },
    notify: {
      email: { type: Boolean, required: true, default: false },
      inApp: { type: Boolean, required: true, default: true },
      dailyHourLocal: intField({ required: true, default: 6, min: 0, max: 23 }),
    },
    onboardingCompletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

settingsSchema.index({ userId: 1 }, { unique: true });

export const SettingsModel = userScopedModel<SettingsDoc>("Settings", settingsSchema, "settings");
