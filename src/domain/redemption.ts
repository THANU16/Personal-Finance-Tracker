// Redemption cost and gain (docs/04 §3). Proportional-cost method by amount (default) or by units.
import { mulDivRound, roundHalfAwayFromZero, sub } from "@/domain/money";

/** Prices carry 4 decimals beyond the currency's minor unit (NAV 12.3456 LKR = 123456). */
export const PRICE_SCALE = 10_000;
/** Units are kept to 6 decimals. */
export const UNIT_DECIMALS = 6;
const UNIT_EPSILON = 1e-9;

export function roundUnits(units: number): number {
  const f = 10 ** UNIT_DECIMALS;
  const r = Math.round(units * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** units × price (price in minor units × 10⁴) → minor units. */
export function unitsValueMinor(units: number, priceMinorE4: number): number {
  return roundHalfAwayFromZero((units * priceMinorE4) / PRICE_SCALE);
}

export interface RedemptionResult {
  amountMinor: number;
  costRemovedMinor: number;
  /** amount − costRemoved − fee */
  realizedGainMinor: number;
  /** amount − fee − tax: what reaches the cash account */
  cashToAccountMinor: number;
  remainingInvestedMinor: number;
  remainingValueMinor: number;
  /** Whole position sold (offer "Close holding"). */
  full: boolean;
  /** Units removed (by-units redemptions, or proportional on tracked holdings). */
  unitsRemoved: number | null;
}

function checkCharges(amountMinor: number, feeMinor: number, taxMinor: number) {
  for (const [label, v] of [
    ["fee", feeMinor],
    ["tax", taxMinor],
  ] as const) {
    if (!Number.isSafeInteger(v) || v < 0)
      throw new RangeError(`${label} must be a non-negative integer`);
  }
  if (feeMinor + taxMinor > amountMinor) throw new RangeError("fee and tax exceed the amount");
}

/**
 * Proportional cost: share = amount / currentValue (exact rational);
 * costRemoved = round(invested × share). amount ≥ value → full redemption.
 */
export function redeemByAmount(input: {
  investedMinor: number;
  currentValueMinor: number;
  amountMinor: number;
  feeMinor?: number;
  taxMinor?: number;
  unitsHeld?: number | null;
}): RedemptionResult {
  const { investedMinor, currentValueMinor, amountMinor } = input;
  const fee = input.feeMinor ?? 0;
  const tax = input.taxMinor ?? 0;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw new RangeError("amount must be > 0");
  if (!Number.isSafeInteger(currentValueMinor) || currentValueMinor <= 0) {
    throw new RangeError("the holding has no value to redeem; update its value first");
  }
  checkCharges(amountMinor, fee, tax);

  const full = amountMinor >= currentValueMinor;
  const costRemovedMinor = full
    ? investedMinor
    : mulDivRound(investedMinor, amountMinor, currentValueMinor);
  const unitsHeld = input.unitsHeld ?? null;
  const unitsRemoved =
    unitsHeld === null
      ? null
      : full
        ? unitsHeld
        : roundUnits((unitsHeld * amountMinor) / currentValueMinor);
  return {
    amountMinor,
    costRemovedMinor,
    realizedGainMinor: sub(sub(amountMinor, costRemovedMinor), fee),
    cashToAccountMinor: amountMinor - fee - tax,
    remainingInvestedMinor: sub(investedMinor, costRemovedMinor),
    remainingValueMinor: full ? 0 : currentValueMinor - amountMinor,
    full,
    unitsRemoved,
  };
}

/**
 * By units (trackUnits): amount = unitsSold × price; costRemoved = round(invested × sold / held).
 */
export function redeemByUnits(input: {
  investedMinor: number;
  currentValueMinor: number;
  unitsHeld: number;
  unitsSold: number;
  priceMinorE4: number;
  feeMinor?: number;
  taxMinor?: number;
}): RedemptionResult {
  const { investedMinor, unitsHeld, unitsSold, priceMinorE4 } = input;
  const fee = input.feeMinor ?? 0;
  const tax = input.taxMinor ?? 0;
  if (!(unitsSold > 0) || !Number.isFinite(unitsSold)) throw new RangeError("units must be > 0");
  if (!(unitsHeld > 0)) throw new RangeError("no units held");
  if (unitsSold > unitsHeld + UNIT_EPSILON)
    throw new RangeError("cannot sell more units than held");
  if (!Number.isSafeInteger(priceMinorE4) || priceMinorE4 <= 0)
    throw new RangeError("price must be > 0");

  const amountMinor = unitsValueMinor(unitsSold, priceMinorE4);
  if (amountMinor <= 0) throw new RangeError("amount rounds to zero");
  checkCharges(amountMinor, fee, tax);
  const full = unitsSold >= unitsHeld - UNIT_EPSILON;
  const costRemovedMinor = full
    ? investedMinor
    : roundHalfAwayFromZero((investedMinor * unitsSold) / unitsHeld);
  return {
    amountMinor,
    costRemovedMinor,
    realizedGainMinor: amountMinor - costRemovedMinor - fee,
    cashToAccountMinor: amountMinor - fee - tax,
    remainingInvestedMinor: investedMinor - costRemovedMinor,
    remainingValueMinor: full ? 0 : Math.max(0, input.currentValueMinor - amountMinor),
    full,
    unitsRemoved: full ? unitsHeld : roundUnits(unitsSold),
  };
}
