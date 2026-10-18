import { z } from "zod";
import { FD_COMPOUNDING, FD_PAYOUTS, type FdCompounding, type FdPayout } from "@/domain/fd";
import { minorUnitDigits } from "@/domain/money";
import { dateKey } from "@/modules/accounts/schemas";
import {
  INSTRUMENT_TYPES,
  LIQUIDITY,
  type HoldingStatus,
  type InstrumentType,
  type Liquidity,
  type ValuationSource,
} from "@/modules/holdings/constants";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const minor = (msg = "Enter an amount") =>
  z
    .number({ error: msg })
    .int("Must be a whole amount")
    .min(0, "Cannot be negative")
    .max(Number.MAX_SAFE_INTEGER);
const positiveMinor = z
  .number({ error: "Enter an amount" })
  .int("Must be a whole amount")
  .positive("Enter an amount above zero")
  .max(Number.MAX_SAFE_INTEGER);
const units = z
  .number({ error: "Enter units" })
  .positive("Enter units above zero")
  .finite()
  .refine((u) => Math.abs(u * 1e6 - Math.round(u * 1e6)) < 1e-6, "At most 6 decimals");
/** Price per unit in minor units × 10⁴ (NAV to 4 extra decimals). */
const priceE4 = z
  .number()
  .int("Invalid price")
  .positive("Enter a price above zero")
  .max(Number.MAX_SAFE_INTEGER);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
  .refine((c) => {
    try {
      minorUnitDigits(c);
      return true;
    } catch {
      return false;
    }
  }, "Unknown currency");
const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(10)
  .default([])
  .transform((t) => Array.from(new Set(t)));

const fdTermsObject = z
  .object({
    principalMinor: positiveMinor,
    rateBp: z.number().int().min(0, "Cannot be negative").max(10_000, "At most 100%"),
    startDate: dateKey,
    maturityDate: dateKey,
    compounding: z.enum(FD_COMPOUNDING),
    payout: z.enum(FD_PAYOUTS),
    payoutAccountId: objectId.nullish().transform((v) => v ?? null),
    autoRenew: z.boolean().default(false),
  })
  .strict();

export const fdTermsSchema = fdTermsObject.refine((v) => v.maturityDate > v.startDate, {
  path: ["maturityDate"],
  message: "Maturity must be after the start date",
});

const holdingFields = {
  name: z.string().trim().min(1, "Enter a name").max(80),
  assetClassId: objectId,
  platform: text(80),
  symbol: text(30),
  liquidity: z.enum(LIQUIDITY),
  tags,
  notes: text(1000),
  countsTowardEmergencyFund: z.boolean(),
};

export const createHoldingSchema = z
  .object({
    ...holdingFields,
    instrumentType: z.enum(INSTRUMENT_TYPES),
    currency,
    liquidity: holdingFields.liquidity.default("medium"),
    countsTowardEmergencyFund: holdingFields.countsTowardEmergencyFund.default(false),
    trackUnits: z.boolean().default(false),
    /** Market holdings: the date the opening values apply to. */
    openingDate: dateKey.optional(),
    investedMinor: minor().optional(),
    currentValueMinor: minor().optional(),
    units: units.nullish(),
    priceMinorE4: priceE4.nullish(),
    fd: fdTermsSchema.nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.instrumentType === "fd") {
      if (!v.fd) ctx.addIssue({ code: "custom", path: ["fd"], message: "Enter the deposit terms" });
      return;
    }
    if (v.fd)
      ctx.addIssue({ code: "custom", path: ["fd"], message: "Only fixed deposits have terms" });
    if (!v.openingDate)
      ctx.addIssue({ code: "custom", path: ["openingDate"], message: "Pick a date" });
    if (v.investedMinor === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["investedMinor"],
        message: "Enter the amount invested",
      });
    }
    if (v.currentValueMinor === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["currentValueMinor"],
        message: "Enter the current value",
      });
    }
    if (!v.trackUnits && (v.units || v.priceMinorE4)) {
      ctx.addIssue({
        code: "custom",
        path: ["units"],
        message: "Turn on unit tracking to enter units",
      });
    }
  });
export type CreateHoldingInput = z.input<typeof createHoldingSchema>;

export const updateHoldingSchema = z
  .object({
    ...holdingFields,
    trackUnits: z.boolean(),
    fd: fdTermsObject.omit({ principalMinor: true, startDate: true }).partial().strict(),
  })
  .partial()
  .strict();
export type UpdateHoldingInput = z.input<typeof updateHoldingSchema>;

export const recordValuationSchema = z
  .object({
    date: dateKey,
    /** New value; for unit-tracked holdings may be derived from `priceMinorE4` instead. */
    valueMinor: minor("Enter the new value").nullish(),
    priceMinorE4: priceE4.nullish(),
    units: units.nullish(),
    confirmBigChange: z.boolean().default(false),
    note: text(200),
  })
  .strict()
  .refine((v) => v.valueMinor != null || v.priceMinorE4 != null, {
    path: ["valueMinor"],
    message: "Enter the new value or price",
  });
export type RecordValuationInput = z.input<typeof recordValuationSchema>;

export const bulkValuationsSchema = z
  .object({
    date: dateKey,
    rows: z
      .array(
        z
          .object({
            holdingId: objectId,
            valueMinor: minor("Enter the new value").nullish(),
            priceMinorE4: priceE4.nullish(),
            confirmBigChange: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1, "Enter at least one new value")
      .max(500),
  })
  .strict();
export type BulkValuationsInput = z.input<typeof bulkValuationsSchema>;

export const closeHoldingSchema = z.object({ force: z.boolean().default(false) }).strict();

export const fdWithdrawSchema = z
  .object({
    date: dateKey,
    toAccountId: objectId,
    /** Gross amount the bank paid out (defaults to the maturity value in the UI). */
    amountMinor: positiveMinor,
    taxMinor: minor().default(0),
    feeMinor: minor().default(0),
  })
  .strict();

export const fdRenewSchema = z
  .object({
    date: dateKey,
    viaAccountId: objectId,
    amountMinor: positiveMinor,
    taxMinor: minor().default(0),
    feeMinor: minor().default(0),
    name: z.string().trim().min(1).max(80).optional(),
    rateBp: z.number().int().min(0).max(10_000),
    maturityDate: dateKey,
    compounding: z.enum(FD_COMPOUNDING),
    payout: z.enum(FD_PAYOUTS),
  })
  .strict()
  .refine((v) => v.maturityDate > v.date, {
    path: ["maturityDate"],
    message: "Maturity must be after the renewal date",
  });

export interface HoldingFdDTO {
  principalMinor: number;
  rateBp: number;
  startDate: string;
  maturityDate: string;
  compounding: FdCompounding;
  payout: FdPayout;
  payoutAccountId: string | null;
  autoRenew: boolean;
  maturityValueMinor: number;
  accruedInterestMinor: number;
  daysToMaturity: number;
  payoutPerPeriodMinor: number | null;
}

export interface HoldingDTO {
  id: string;
  name: string;
  assetClass: { id: string; name: string; color: string };
  instrumentType: InstrumentType;
  currency: string;
  platform: string | null;
  symbol: string | null;
  liquidity: Liquidity;
  tags: string[];
  notes: string | null;
  trackUnits: boolean;
  countsTowardEmergencyFund: boolean;
  status: HoldingStatus;
  fd: HoldingFdDTO | null;
  investedMinor: number;
  currentValueMinor: number;
  units: number | null;
  avgCostMinor: number | null;
  realizedGainMinor: number;
  incomeReceivedMinor: number;
  feesPaidMinor: number;
  taxWithheldMinor: number;
  unrealizedGainMinor: number;
  /** Unrealised ÷ invested; null when nothing is invested. */
  unrealizedBp: number | null;
  totalReturnMinor: number;
  firstInvestedAt: string | null;
  lastValuedAt: string | null;
  lastPriceMinorE4: number | null;
  stale: boolean;
  /** Days since the last valuation (null if never). */
  daysSinceValued: number | null;
  xirrBp: number | null;
}

export interface ValuationDTO {
  id: string;
  date: string;
  valueMinor: number;
  priceMinorE4: number | null;
  units: number | null;
  source: ValuationSource;
  note: string | null;
}
