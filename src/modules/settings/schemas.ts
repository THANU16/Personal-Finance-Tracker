import { z } from "zod";
import { EMERGENCY_BASES, type EmergencyBasis } from "@/domain/essentials";
import { minorUnitDigits } from "@/domain/money";

const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const isValidCurrency = (code: string) => {
  try {
    minorUnitDigits(code);
    return true;
  } catch {
    return false;
  }
};

const isValidLocale = (locale: string) => {
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
};

const int = (min: number, max: number) =>
  z
    .number()
    .int("Must be a whole number")
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`);

const minorAmount = z
  .number()
  .int("Must be a whole amount")
  .min(0, "Cannot be negative")
  .max(Number.MAX_SAFE_INTEGER);

const positiveMinorAmount = z
  .number()
  .int("Must be a whole amount")
  .min(1, "Must be more than zero")
  .max(Number.MAX_SAFE_INTEGER);

export const updateSettingsSchema = z
  .object({
    baseCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
      .refine(isValidCurrency, "Unknown currency"),
    timezone: z.string().min(1).refine(isValidTimezone, "Unknown timezone"),
    locale: z.string().min(2).refine(isValidLocale, "Unknown locale"),
    staleDays: int(1, 365),
    bigChangeThresholdBp: int(100, 10_000),
    driftThresholdBp: int(50, 5_000),
    emergencyMonths: int(1, 24),
    emergencyExpenseBasis: z.enum(EMERGENCY_BASES),
    emergencyManualMonthlyMinor: positiveMinorAmount.nullable(),
    emergencyTargetOverrideMinor: positiveMinorAmount.nullable(),
    lifeCoverIncomeMultiple: int(1, 30),
    healthCoverTargetMinor: minorAmount.nullable(),
    minBalanceWarningMinor: minorAmount,
    notify: z
      .object({
        email: z.boolean(),
        inApp: z.boolean(),
        dailyHourLocal: int(0, 23),
      })
      .strict(),
  })
  .strict()
  .partial();

export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

export const setHideAmountsSchema = z.object({ hideAmounts: z.boolean() }).strict();

export interface SettingsDTO {
  baseCurrency: string;
  timezone: string;
  locale: string;
  staleDays: number;
  bigChangeThresholdBp: number;
  driftThresholdBp: number;
  emergencyMonths: number;
  emergencyExpenseBasis: EmergencyBasis;
  emergencyManualMonthlyMinor: number | null;
  emergencyTargetOverrideMinor: number | null;
  lifeCoverIncomeMultiple: number;
  healthCoverTargetMinor: number | null;
  minBalanceWarningMinor: number;
  hideAmounts: boolean;
  notify: { email: boolean; inApp: boolean; dailyHourLocal: number };
  onboardingCompletedAt: string | null;
  bootstrapVersion: number;
}
