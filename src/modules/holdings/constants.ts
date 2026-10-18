// Client-safe holding enums (model.ts imports mongoose; keep these out of it).

export const INSTRUMENT_TYPES = [
  "stock",
  "mutual_fund",
  "unit_trust",
  "etf",
  "bond",
  "treasury",
  "fd",
  "gold",
  "crypto",
  "real_estate",
  "epf_etf",
  "other",
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const LIQUIDITY = ["high", "medium", "low"] as const;
export type Liquidity = (typeof LIQUIDITY)[number];

export const HOLDING_STATUSES = ["active", "closed"] as const;
export type HoldingStatus = (typeof HOLDING_STATUSES)[number];

export const VALUATION_SOURCES = [
  "manual",
  "auto_on_buy",
  "auto_on_redeem",
  "fd_calc",
  "bulk",
  "price_feed",
] as const;
export type ValuationSource = (typeof VALUATION_SOURCES)[number];
