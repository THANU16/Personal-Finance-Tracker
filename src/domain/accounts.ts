// Account rules: types, liability sign convention, credit card utilisation and due dates.
import { divRound } from "@/domain/money";

export const ACCOUNT_TYPES = [
  "bank",
  "cash",
  "wallet",
  "credit_card",
  "loan",
  "broker_cash",
  "opportunity_fund",
  "receivable",
  "payable",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Liabilities sit below zero (docs/04 §1). */
export const LIABILITY_TYPES: readonly AccountType[] = ["credit_card", "loan", "payable"];

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

/** docs/05 §3 groups, in display order. */
export const ACCOUNT_GROUPS = [
  { key: "cash", label: "Cash & bank", types: ["bank", "cash", "wallet"] },
  { key: "cards", label: "Cards", types: ["credit_card"] },
  { key: "loans", label: "Loans", types: ["loan"] },
  { key: "investment_cash", label: "Investment cash", types: ["broker_cash"] },
  { key: "opportunity", label: "Opportunity fund", types: ["opportunity_fund"] },
  { key: "receivables", label: "Receivables & payables", types: ["receivable", "payable"] },
] as const satisfies readonly { key: string; label: string; types: readonly AccountType[] }[];

/** Card outstanding (positive when owed) from its signed balance. */
export function cardOutstandingMinor(balanceMinor: number): number {
  return balanceMinor < 0 ? -balanceMinor : 0;
}

/** Utilisation of a credit limit in bp (may exceed 10000 when over limit); null without a limit. */
export function cardUtilisationBp(
  balanceMinor: number,
  limitMinor: number | null | undefined,
): number | null {
  if (!limitMinor || limitMinor <= 0) return null;
  return divRound(cardOutstandingMinor(balanceMinor) * 10_000, limitMinor);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
}

function parseDateKey(key: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`invalid date key ${key}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Next occurrence of a monthly `day` (1–31; clamped to the month's length) on or after `todayKey`
 * (`YYYY-MM-DD` in the user's timezone).
 */
export function nextMonthlyDate(todayKey: string, day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`invalid day ${day}`);
  const t = parseDateKey(todayKey);
  const thisMonth = Math.min(day, daysInMonth(t.y, t.m));
  if (thisMonth >= t.d) return key(t.y, t.m, thisMonth);
  const y = t.m === 12 ? t.y + 1 : t.y;
  const m = t.m === 12 ? 1 : t.m + 1;
  return key(y, m, Math.min(day, daysInMonth(y, m)));
}
