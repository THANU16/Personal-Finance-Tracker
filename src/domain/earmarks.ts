// docs/04 §20 — earmarks (cash buckets), free cash and the dip guard. Pure: no DB, integer minor units.
import type { AccountType } from "@/domain/accounts";
import { divRound } from "@/domain/money";

export const BUCKETS = ["emergency", "opportunity"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Move endpoints: a bucket or the account's free cash. */
export const BUCKET_SLOTS = ["free", "emergency", "opportunity"] as const;
export type BucketSlot = (typeof BUCKET_SLOTS)[number];

export const EARMARK_MODES = ["fixed", "percent"] as const;
export type EarmarkMode = (typeof EARMARK_MODES)[number];

/** Account types that can carry explicit earmarks (when not dedicated). */
export const EARMARKABLE_TYPES: readonly AccountType[] = ["bank", "cash", "wallet", "broker_cash"];

export interface EarmarkLike {
  bucket: Bucket;
  mode: EarmarkMode;
  amountMinor?: number | null;
  percentBp?: number | null;
}

export interface AccountLike {
  type: AccountType;
  countsTowardEmergencyFund: boolean;
  balanceMinor: number;
  archivedAt?: Date | string | null;
}

export interface EffectiveEarmarks {
  emergencyMinor: number;
  opportunityMinor: number;
  freeMinor: number;
  /** Σ raw earmarks exceeded the balance; effective values were reduced (opportunity first). */
  overEarmarked: boolean;
}

/**
 * The bucket a dedicated account belongs to as a whole: `opportunity_fund` accounts are opportunity
 * money, accounts flagged `countsTowardEmergencyFund` are emergency money. The type wins if both apply.
 */
export function dedicatedBucket(
  account: Pick<AccountLike, "type" | "countsTowardEmergencyFund">,
): Bucket | null {
  if (account.type === "opportunity_fund") return "opportunity";
  if (account.countsTowardEmergencyFund) return "emergency";
  return null;
}

/** Can this account type carry explicit earmarks at all (ignoring its balance)? */
export function canCarryEarmarks(
  account: Pick<AccountLike, "type" | "countsTowardEmergencyFund">,
): boolean {
  return EARMARKABLE_TYPES.includes(account.type) && dedicatedBucket(account) === null;
}

/** Earmarkable now: right type, not dedicated, not archived, balance above zero. */
export function isEarmarkable(account: AccountLike): boolean {
  return canCarryEarmarks(account) && !account.archivedAt && account.balanceMinor > 0;
}

/** fixed → amount; percent → round(B × bp / 10000) (0 when the balance is not positive). */
export function rawEarmark(balanceMinor: number, earmark: EarmarkLike): number {
  if (earmark.mode === "fixed") return Math.max(0, earmark.amountMinor ?? 0);
  if (balanceMinor <= 0) return 0;
  return divRound(balanceMinor * (earmark.percentBp ?? 0), 10_000);
}

/**
 * Effective earmarks on balance B: if Σ raw > B reduce opportunity first, then emergency, until they
 * fit. Stored values are untouched. free = B − Σ effective.
 */
export function effectiveEarmarks(
  balanceMinor: number,
  earmarks: readonly EarmarkLike[],
): EffectiveEarmarks {
  let rawEmergency = 0;
  let rawOpportunity = 0;
  for (const e of earmarks) {
    const raw = rawEarmark(balanceMinor, e);
    if (e.bucket === "emergency") rawEmergency += raw;
    else rawOpportunity += raw;
  }
  const room = Math.max(0, balanceMinor);
  let excess = rawEmergency + rawOpportunity - room;
  const overEarmarked = excess > 0;
  let opportunityMinor = rawOpportunity;
  let emergencyMinor = rawEmergency;
  if (excess > 0) {
    const cut = Math.min(excess, opportunityMinor);
    opportunityMinor -= cut;
    excess -= cut;
    emergencyMinor -= Math.min(excess, emergencyMinor);
  }
  return {
    emergencyMinor,
    opportunityMinor,
    freeMinor: balanceMinor - emergencyMinor - opportunityMinor,
    overEarmarked,
  };
}

export interface DipCheck {
  needsConfirm: boolean;
  dipsOpportunityMinor: number;
  dipsEmergencyMinor: number;
}

/**
 * Dip guard for an outflow X: beyond free cash it takes opportunity money first, then emergency.
 * An overdraft beyond every bucket only reports what is actually earmarked.
 */
export function dipCheck(outflowMinor: number, effective: EffectiveEarmarks): DipCheck {
  const over = outflowMinor - Math.max(0, effective.freeMinor);
  if (over <= 0) return { needsConfirm: false, dipsOpportunityMinor: 0, dipsEmergencyMinor: 0 };
  const dipsOpportunityMinor = Math.min(over, effective.opportunityMinor);
  const dipsEmergencyMinor = Math.min(over - dipsOpportunityMinor, effective.emergencyMinor);
  return {
    needsConfirm: dipsOpportunityMinor + dipsEmergencyMinor > 0,
    dipsOpportunityMinor,
    dipsEmergencyMinor,
  };
}

/** New stored (fixed) amounts per bucket; `null` = leave that bucket's stored earmark as it is. */
export interface BucketAmounts {
  emergencyMinor: number | null;
  opportunityMinor: number | null;
}

/** After a confirmed dip: each dipped bucket is stored as fixed (effective − dip). */
export function earmarksAfterDip(effective: EffectiveEarmarks, dip: DipCheck): BucketAmounts {
  return {
    opportunityMinor:
      dip.dipsOpportunityMinor > 0 ? effective.opportunityMinor - dip.dipsOpportunityMinor : null,
    emergencyMinor:
      dip.dipsEmergencyMinor > 0 ? effective.emergencyMinor - dip.dipsEmergencyMinor : null,
  };
}

/**
 * Move between free / emergency / opportunity on one account. Touched buckets become fixed amounts
 * computed from the effective values; no money moves, so the balance never changes.
 */
export function moveBetweenBuckets(
  effective: EffectiveEarmarks,
  from: BucketSlot,
  to: BucketSlot,
  amountMinor: number,
): BucketAmounts {
  if (from === to) throw new RangeError("Choose two different buckets");
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError("Enter an amount above zero");
  }
  const available =
    from === "free"
      ? Math.max(0, effective.freeMinor)
      : from === "emergency"
        ? effective.emergencyMinor
        : effective.opportunityMinor;
  if (amountMinor > available) {
    throw new RangeError(
      `Only ${available} is available in ${from === "free" ? "free cash" : from}`,
    );
  }
  const next: BucketAmounts = { emergencyMinor: null, opportunityMinor: null };
  for (const [slot, delta] of [
    [from, -amountMinor],
    [to, amountMinor],
  ] as const) {
    if (slot === "emergency") next.emergencyMinor = effective.emergencyMinor + delta;
    if (slot === "opportunity") next.opportunityMinor = effective.opportunityMinor + delta;
  }
  return next;
}

// ---------------------------------------------------------------------------- tagged transactions
// Owner request: a transaction can optionally say which bucket its money leaves from or arrives in
// (default: none = free cash, the normal behaviour). The earmarks follow in the same DB transaction.

/** Bucket a tagged outflow is paid from: that bucket drops by the outflow; refused if it holds less. */
export function earmarksAfterBucketSpend(
  effective: EffectiveEarmarks,
  bucket: Bucket,
  outflowMinor: number,
): BucketAmounts {
  const have = bucket === "emergency" ? effective.emergencyMinor : effective.opportunityMinor;
  if (outflowMinor > have) throw new RangeError(`Only ${have} is ${bucket} money on this account`);
  return bucket === "emergency"
    ? { emergencyMinor: have - outflowMinor, opportunityMinor: null }
    : { emergencyMinor: null, opportunityMinor: have - outflowMinor };
}

/**
 * Money tagged to a bucket has arrived (`effective` is AFTER the inflow): the bucket grows by the
 * inflow, never past the account's free cash (an overdrawn account cannot earmark more than it has).
 */
export function earmarksAfterBucketReceive(
  effective: EffectiveEarmarks,
  bucket: Bucket,
  inflowMinor: number,
): BucketAmounts {
  const add = Math.min(inflowMinor, Math.max(0, effective.freeMinor));
  return bucket === "emergency"
    ? { emergencyMinor: effective.emergencyMinor + add, opportunityMinor: null }
    : { emergencyMinor: null, opportunityMinor: effective.opportunityMinor + add };
}

/**
 * Voiding a tagged transaction (`effective` is BEFORE the void): an arrival leaves its bucket again
 * (not below 0); a payment goes back into the bucket it came from (the money returns with it).
 */
export function earmarksAfterBucketUndo(
  effective: EffectiveEarmarks,
  bucket: Bucket,
  kind: "spend" | "receive",
  amountMinor: number,
): BucketAmounts {
  const have = bucket === "emergency" ? effective.emergencyMinor : effective.opportunityMinor;
  const next = kind === "receive" ? Math.max(0, have - amountMinor) : have + amountMinor;
  return bucket === "emergency"
    ? { emergencyMinor: next, opportunityMinor: null }
    : { emergencyMinor: null, opportunityMinor: next };
}
