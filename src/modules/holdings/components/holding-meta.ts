import {
  INSTRUMENT_TYPES,
  type InstrumentType,
  type Liquidity,
} from "@/modules/holdings/constants";

export const INSTRUMENT_LABEL: Record<InstrumentType, string> = {
  stock: "Stock",
  mutual_fund: "Mutual fund",
  unit_trust: "Unit trust",
  etf: "ETF",
  bond: "Bond",
  treasury: "Treasury bill/bond",
  money_market: "Money market",
  fd: "Fixed deposit",
  gold: "Gold",
  crypto: "Crypto",
  real_estate: "Real estate",
  epf_etf: "EPF / ETF",
  other: "Other",
};

export const LIQUIDITY_LABEL: Record<Liquidity, string> = {
  high: "High (days)",
  medium: "Medium (weeks)",
  low: "Low (months+)",
};

const CLASS_INSTRUMENTS: Record<string, InstrumentType[]> = {
  equity: ["stock", "unit_trust", "mutual_fund", "etf", "other"],
  "fixed income": [
    "money_market",
    "fd",
    "bond",
    "treasury",
    "unit_trust",
    "mutual_fund",
    "epf_etf",
    "other",
  ],
  gold: ["gold", "etf", "other"],
  crypto: ["crypto", "other"],
  "real estate": ["real_estate", "other"],
  "cash & equivalents": ["money_market", "fd", "treasury", "other"],
};

/** Instrument types offered for an asset class (by its name); unknown/custom classes get every type. */
export function instrumentsForClass(className: string | null | undefined): InstrumentType[] {
  return CLASS_INSTRUMENTS[(className ?? "").trim().toLowerCase()] ?? [...INSTRUMENT_TYPES];
}

/** Instruments that usually have units and a NAV/price. */
export const UNIT_INSTRUMENTS: InstrumentType[] = [
  "stock",
  "mutual_fund",
  "unit_trust",
  "money_market",
  "etf",
  "gold",
  "crypto",
];
