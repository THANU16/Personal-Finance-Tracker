// Integer money math. All amounts are minor units (e.g. cents); percentages are basis points
// (10000 = 100%). Pure: no I/O, no framework imports. See docs/04-BUSINESS-RULES.md.

export const BP_SCALE = 10_000;

function assertMinor(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer (minor units), got ${value}`);
  }
}

/** Sum of integer minor-unit amounts. */
export function add(...amounts: number[]): number {
  let total = 0;
  for (const a of amounts) {
    assertMinor(a);
    total += a;
  }
  assertMinor(total, "sum");
  return total;
}

/** a − b for integer minor-unit amounts. */
export function sub(a: number, b: number): number {
  assertMinor(a);
  assertMinor(b);
  const result = a - b;
  assertMinor(result, "difference");
  return result;
}

/** Rounds half away from zero (2.5 → 3, −2.5 → −3). Never returns −0. */
export function roundHalfAwayFromZero(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`cannot round ${x}`);
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

/** Integer division n / d rounded half away from zero, exact for safe integers. */
export function divRound(n: number, d: number): number {
  assertMinor(n, "numerator");
  assertMinor(d, "denominator");
  if (d === 0) throw new RangeError("division by zero");
  const q = Math.trunc(n / d);
  const r = n - q * d;
  let result = q;
  if (2 * Math.abs(r) >= Math.abs(d)) result += Math.sign(n) * Math.sign(d);
  return result === 0 ? 0 : result;
}

/** amount × bp / 10000, rounded half away from zero. */
export function mulBp(amountMinor: number, bp: number): number {
  assertMinor(amountMinor);
  assertMinor(bp, "bp");
  return divRound(amountMinor * bp, BP_SCALE);
}

/**
 * Splits `total` proportionally to `weights` so the parts sum exactly to `total`.
 * Floors each share, then hands leftover minor units to the largest fractional remainders
 * (ties → earlier item). Negative totals split symmetrically.
 */
export function allocateLargestRemainder(total: number, weights: readonly number[]): number[] {
  assertMinor(total, "total");
  if (weights.length === 0) throw new RangeError("weights must not be empty");
  let weightSum = 0;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`weights must be non-negative integers, got ${w}`);
    }
    weightSum += w;
  }
  if (weightSum === 0) throw new RangeError("weights must not all be zero");
  if (!Number.isSafeInteger(weightSum)) throw new RangeError("weight sum must be a safe integer");

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  // Large totals × large weights (e.g. LKR 2.7M × class% × asset% weights) exceed 2^53: same
  // algorithm in exact BigInt arithmetic.
  if (!Number.isSafeInteger(abs * weightSum)) return allocateBig(abs, weights, weightSum, sign);
  const parts = weights.map((w) => Math.floor((abs * w) / weightSum));
  // Remainders as integers (abs*w mod weightSum) to avoid float comparisons.
  const remainders = weights.map((w, i) => ({ i, rem: abs * w - parts[i]! * weightSum }));

  let leftover = abs - parts.reduce((s, p) => s + p, 0);
  remainders.sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; leftover > 0; k++, leftover--) {
    parts[remainders[k]!.i]! += 1;
  }
  return parts.map((p) => (p === 0 ? 0 : sign * p));
}

function allocateBig(
  abs: number,
  weights: readonly number[],
  weightSum: number,
  sign: number,
): number[] {
  const A = BigInt(abs);
  const W = BigInt(weightSum);
  const parts = weights.map((w) => (A * BigInt(w)) / W);
  const remainders = weights.map((w, i) => ({ i, rem: A * BigInt(w) - parts[i]! * W }));
  let leftover = A - parts.reduce((s, p) => s + p, 0n);
  remainders.sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.i - y.i));
  for (let k = 0; leftover > 0n; k++, leftover--) parts[remainders[k]!.i]! += 1n;
  return parts.map((p) => (p === 0n ? 0 : sign * Number(p)));
}

const CRYPTO_DIGITS: Record<string, number> = { BTC: 8, ETH: 8 };

/** Number of minor-unit digits for a currency (ISO 4217 via Intl; crypto overrides). */
export function minorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  const crypto = CRYPTO_DIGITS[code];
  if (crypto !== undefined) return crypto;
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    throw new RangeError(`unknown currency ${currency}`);
  }
}

const MONEY_TEXT = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/**
 * Parses a typed decimal ("1,250.50", "-3", ".5") into an integer scaled by 10^digits, without
 * floats. Returns null for empty input; throws on junk or more than `digits` decimal places.
 */
export function parseScaledDecimal(text: string, digits: number): number | null {
  const trimmed = text.trim().replace(/\s/g, "");
  if (trimmed === "") return null;
  const m = MONEY_TEXT.exec(trimmed);
  if (!m || (m[2] === undefined && (m[3] === undefined || m[3] === ""))) {
    throw new RangeError(`"${text}" is not a valid number`);
  }
  const whole = (m[2] ?? "0").replace(/,/g, "");
  const frac = m[3] ?? "";
  if (frac.length > digits) throw new RangeError(`at most ${digits} decimal places`);
  const value = Number(whole + frac.padEnd(digits, "0"));
  if (!Number.isSafeInteger(value)) throw new RangeError(`"${text}" is too large`);
  const signed = m[1] === "-" ? -value : value;
  return signed === 0 ? 0 : signed;
}

/** User-typed money → minor units for `currency` (e.g. "1,250.5" LKR → 125050). */
export function parseMoneyToMinor(text: string, currency: string): number | null {
  return parseScaledDecimal(text, minorUnitDigits(currency));
}

/** User-typed percent → basis points ("12.5" → 1250, max 2 decimals). */
export function parsePercentToBp(text: string): number | null {
  return parseScaledDecimal(text.replace(/%$/, ""), 2);
}

/** Basis points → plain percent string for inputs (1250 → "12.5", 1205 → "12.05"). */
export function bpToPercentString(bp: number): string {
  assertMinor(bp, "bp");
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Minor units → plain decimal string with exactly the currency's digits ("-1250.50"). */
export function minorToDecimalString(amountMinor: number, currency: string): string {
  assertMinor(amountMinor);
  const digits = minorUnitDigits(currency);
  const abs = Math.abs(amountMinor).toString();
  const sign = amountMinor < 0 ? "-" : "";
  if (digits === 0) return sign + abs;
  const padded = abs.padStart(digits + 1, "0");
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/**
 * round(a × b / c) half away from zero, exact for any safe integers (BigInt intermediate), so
 * products like invested × amount never lose precision beyond 2^53.
 */
export function mulDivRound(a: number, b: number, c: number): number {
  assertMinor(a, "a");
  assertMinor(b, "b");
  assertMinor(c, "c");
  if (c === 0) throw new RangeError("division by zero");
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const q = num / den;
  const r = num - q * den;
  const abs = (x: bigint) => (x < 0n ? -x : x);
  let result = q;
  if (2n * abs(r) >= abs(den)) result += num < 0n === den < 0n ? 1n : -1n;
  const out = Number(result);
  assertMinor(out, "result");
  return out === 0 ? 0 : out;
}

/** Integer scaled by 10^digits → plain decimal string ("123456", 4 → "12.3456"). */
export function scaledToDecimalString(value: number, digits: number): string {
  assertMinor(value);
  const abs = Math.abs(value).toString();
  const sign = value < 0 ? "-" : "";
  if (digits === 0) return sign + abs;
  const padded = abs.padStart(digits + 1, "0");
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/** Decimal places of a price: the currency's minor digits + 4 (NAV precision). */
export function priceDigits(currency: string): number {
  return minorUnitDigits(currency) + 4;
}
