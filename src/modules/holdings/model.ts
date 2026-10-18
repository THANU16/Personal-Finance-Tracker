import { Schema, type Types } from "mongoose";
import { FD_COMPOUNDING, FD_PAYOUTS, type FdCompounding, type FdPayout } from "@/domain/fd";
import { intField, userScopedModel } from "@/server/db/model";

export * from "@/modules/holdings/constants";
import {
  HOLDING_STATUSES,
  INSTRUMENT_TYPES,
  LIQUIDITY,
  VALUATION_SOURCES,
  type HoldingStatus,
  type InstrumentType,
  type Liquidity,
  type ValuationSource,
} from "@/modules/holdings/constants";

export interface HoldingFd {
  principalMinor: number;
  rateBp: number;
  startDate: Date;
  maturityDate: Date;
  compounding: FdCompounding;
  payout: FdPayout;
  payoutAccountId: Types.ObjectId | null;
  autoRenew: boolean;
}

// docs/03-DATA-MODEL.md — holdings
export interface HoldingDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  assetClassId: Types.ObjectId;
  instrumentType: InstrumentType;
  currency: string;
  platform: string | null;
  symbol: string | null;
  liquidity: Liquidity;
  tags: string[];
  notes: string | null;
  trackUnits: boolean;
  fd: HoldingFd | null;
  countsTowardEmergencyFund: boolean;
  status: HoldingStatus;
  closedAt: Date | null;
  // caches — recomputeHolding
  investedMinor: number;
  currentValueMinor: number;
  units: number | null;
  avgCostMinor: number | null;
  realizedGainMinor: number;
  incomeReceivedMinor: number;
  feesPaidMinor: number;
  taxWithheldMinor: number;
  firstInvestedAt: Date | null;
  lastValuedAt: Date | null;
  /** minor units × 10⁴ */
  lastPriceMinorE4: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const fdSchema = new Schema<HoldingFd>(
  {
    principalMinor: intField({ required: true, min: 1 }),
    rateBp: intField({ required: true, min: 0 }),
    startDate: { type: Date, required: true },
    maturityDate: { type: Date, required: true },
    compounding: { type: String, enum: FD_COMPOUNDING, required: true },
    payout: { type: String, enum: FD_PAYOUTS, required: true },
    payoutAccountId: { type: Schema.Types.ObjectId, default: null },
    autoRenew: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const holdingSchema = new Schema<HoldingDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    assetClassId: { type: Schema.Types.ObjectId, required: true },
    instrumentType: { type: String, enum: INSTRUMENT_TYPES, required: true },
    currency: { type: String, required: true },
    platform: { type: String, default: null },
    symbol: { type: String, default: null },
    liquidity: { type: String, enum: LIQUIDITY, required: true, default: "medium" },
    tags: { type: [String], default: [] },
    notes: { type: String, default: null },
    trackUnits: { type: Boolean, required: true, default: false },
    fd: { type: fdSchema, default: null },
    countsTowardEmergencyFund: { type: Boolean, required: true, default: false },
    status: { type: String, enum: HOLDING_STATUSES, required: true, default: "active" },
    closedAt: { type: Date, default: null },
    investedMinor: intField({ required: true, default: 0 }),
    currentValueMinor: intField({ required: true, default: 0 }),
    units: { type: Number, default: null },
    avgCostMinor: intField({ default: null }),
    realizedGainMinor: intField({ required: true, default: 0 }),
    incomeReceivedMinor: intField({ required: true, default: 0 }),
    feesPaidMinor: intField({ required: true, default: 0 }),
    taxWithheldMinor: intField({ required: true, default: 0 }),
    firstInvestedAt: { type: Date, default: null },
    lastValuedAt: { type: Date, default: null },
    lastPriceMinorE4: intField({ default: null, min: 0 }),
  },
  { timestamps: true },
);

holdingSchema.index({ userId: 1, status: 1 });
holdingSchema.index({ userId: 1, assetClassId: 1 });

export const HoldingModel = userScopedModel<HoldingDoc>("Holding", holdingSchema, "holdings");

// docs/03-DATA-MODEL.md — valuations
export interface ValuationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  holdingId: Types.ObjectId;
  date: Date;
  valueMinor: number;
  /** minor units × 10⁴ */
  priceMinorE4: number | null;
  units: number | null;
  source: ValuationSource;
  note: string | null;
  /** Set for valuations created by an import (undo removes them). */
  importBatchId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const valuationSchema = new Schema<ValuationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    holdingId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },
    valueMinor: intField({ required: true, min: 0 }),
    priceMinorE4: intField({ default: null, min: 0 }),
    units: { type: Number, default: null },
    source: { type: String, enum: VALUATION_SOURCES, required: true, default: "manual" },
    note: { type: String, default: null },
    importBatchId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

valuationSchema.index({ userId: 1, holdingId: 1, date: -1 });

export const ValuationModel = userScopedModel<ValuationDoc>(
  "Valuation",
  valuationSchema,
  "valuations",
);
