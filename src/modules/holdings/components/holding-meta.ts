import type { InstrumentType, Liquidity } from "@/modules/holdings/constants";

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
