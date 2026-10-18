// Display formatting (client-safe). Money is formatted from integer minor units via an exact
// decimal string — never through float division.
import {
  minorToDecimalString,
  minorUnitDigits,
  priceDigits,
  scaledToDecimalString,
} from "@/domain/money";

export const DEFAULT_LOCALE = "en-LK";

export interface FormatMoneyOptions {
  locale?: string;
  /** `LKR 1.25M` instead of `LKR 1,250,000.00`. */
  compact?: boolean;
  /** Prefix positive values with `+` (e.g. gains). */
  signed?: boolean;
}

type DecimalFormat = (value: string) => string;

const formatterCache = new Map<string, DecimalFormat>();

function decimalFormatter(locale: string, digits: number, compact: boolean): DecimalFormat {
  const key = `${locale}|${digits}|${compact}`;
  let f = formatterCache.get(key);
  if (!f) {
    const nf = new Intl.NumberFormat(locale, {
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 2 }
        : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
      signDisplay: "never",
    });
    // Intl accepts exact decimal strings; the cast avoids older lib typings that only list number.
    f = (value: string) => nf.format(value as unknown as number);
    formatterCache.set(key, f);
  }
  return f;
}

/** `LKR 1,250,000.00`, `-LKR 1,250.00`, compact `LKR 1.25M`. */
export function formatMoney(
  amountMinor: number,
  currency: string,
  { locale = DEFAULT_LOCALE, compact = false, signed = false }: FormatMoneyOptions = {},
): string {
  const code = currency.toUpperCase();
  const digits = minorUnitDigits(code);
  const body = decimalFormatter(locale, digits, compact)(minorToDecimalString(amountMinor, code));
  const sign = amountMinor < 0 ? "-" : signed && amountMinor > 0 ? "+" : "";
  return `${sign}${code} ${body}`;
}

/** Compact money for cards (`LKR 1.25M`); pair with the full value in a tooltip. */
export function formatCompact(amountMinor: number, currency: string, locale?: string): string {
  return formatMoney(amountMinor, currency, { compact: true, locale });
}

/** Basis points → percent with 1 decimal: 1234 → `12.3%`. Rounds half away from zero. */
export function formatPercentBp(bp: number, { signed = false }: { signed?: boolean } = {}): string {
  if (!Number.isSafeInteger(bp)) throw new RangeError(`bp must be an integer, got ${bp}`);
  const abs = Math.abs(bp);
  const tenths = Math.floor(abs / 10) + (abs % 10 >= 5 ? 1 : 0); // bp/10 = tenths of a percent
  const text = `${Math.floor(tenths / 10)}.${tenths % 10}%`;
  if (tenths === 0) return "0.0%";
  if (bp < 0) return `-${text}`;
  return signed ? `+${text}` : text;
}

/**
 * Price per unit (minor units × 10⁴) → `LKR 12.3456`: at least the currency's decimals, up to 4
 * more, trailing zeros trimmed.
 */
export function formatPrice(
  priceMinorE4: number,
  currency: string,
  locale = DEFAULT_LOCALE,
): string {
  const code = currency.toUpperCase();
  const min = minorUnitDigits(code);
  const text = scaledToDecimalString(priceMinorE4, priceDigits(code));
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: min + 4,
  });
  return `${code} ${nf.format(text as unknown as number)}`;
}

/** Units with thousands separators and up to 6 decimals: `1,234.5678`. */
export function formatUnits(units: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(units);
}
