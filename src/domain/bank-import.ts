// Bank statement CSV import (Phase 11). Pure: column mapping, date/amount parsing, row
// normalisation and the dedupe key. The service hashes the key (sha256) and posts the rows.
import { minorUnitDigits, parseScaledDecimal } from "@/domain/money";

export const DATE_FORMATS = [
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "dd-MM-yyyy",
  "dd.MM.yyyy",
  "dd-MMM-yyyy",
  "dd MMM yyyy",
  "yyyy/MM/dd",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface BankMapping {
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: DateFormat;
  descriptionColumn: number;
  counterpartyColumn: number | null;
  /** "signed": one column, + money in / − money out; "debit_credit": two columns. */
  amountMode: "signed" | "debit_credit";
  amountColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  /** Flip the sign of a signed amount (banks that show spending as positive). */
  negate: boolean;
}

export interface BankRow {
  /** 1-based line in the file (header included). */
  line: number;
  date: string;
  /** Signed: + money in (income), − money out (expense). */
  amountMinor: number;
  description: string;
  counterparty: string | null;
}

export interface BankRowError {
  line: number;
  message: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function validKey(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Date text in `format` → `YYYY-MM-DD`, or null. A time after the date is ignored. */
export function parseBankDate(text: string, format: DateFormat): string | null {
  const s = text
    .trim()
    .split(/[ T](?=\d{1,2}:\d{2})/)[0]!
    .trim();
  let m: RegExpExecArray | null;
  switch (format) {
    case "yyyy-MM-dd":
    case "yyyy/MM/dd":
      m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
      return m ? validKey(+m[1]!, +m[2]!, +m[3]!) : null;
    case "dd/MM/yyyy":
    case "dd-MM-yyyy":
    case "dd.MM.yyyy":
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
      return m ? validKey(+m[3]!, +m[2]!, +m[1]!) : null;
    case "MM/dd/yyyy":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return m ? validKey(+m[3]!, +m[1]!, +m[2]!) : null;
    case "dd-MMM-yyyy":
    case "dd MMM yyyy": {
      m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ,]+(\d{4})$/.exec(s);
      const month = m ? MONTHS.indexOf(m[2]!.toLowerCase()) + 1 : 0;
      return m && month ? validKey(+m[3]!, month, +m[1]!) : null;
    }
  }
}

/**
 * Amount text → minor units. Accepts thousands separators, a currency code or symbol, (1,234.50)
 * and trailing "-" for negatives, and "DR"/"CR" suffixes (DR = money out). null when empty.
 * Throws on anything else.
 */
export function parseBankAmount(text: string, currency: string): number | null {
  let s = text.trim();
  if (s === "") return null;
  let sign = 1;
  const drcr = /\s*\b(DR|CR)\.?$/i.exec(s);
  if (drcr) {
    if (drcr[1]!.toUpperCase() === "DR") sign = -1;
    s = s.slice(0, drcr.index);
  }
  if (/^\(.*\)$/.test(s)) {
    sign *= -1;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    sign *= -1;
    s = s.slice(0, -1);
  }
  s = s
    .replace(/^(?:Rs\.?|[A-Za-z]{3})\s*(?=[\d.+\-(])/i, "")
    .replace(/^[^\dA-Za-z+\-.(]+/, "")
    .replace(/\s/g, "");
  const v = parseScaledDecimal(s, minorUnitDigits(currency));
  if (v === null) return null;
  return v === 0 ? 0 : sign * v;
}

const HEADER_HINTS: Record<
  "date" | "description" | "amount" | "debit" | "credit" | "counterparty",
  RegExp
> = {
  date: /^(txn |transaction |value |posting |booking )?date$|^date\b/i,
  description: /description|narration|details|particulars|remarks?|memo|reference/i,
  amount: /^amount|amount$/i,
  debit: /debit|withdrawal|paid out|money out|^dr$/i,
  credit: /credit|deposit|paid in|money in|^cr$/i,
  counterparty: /payee|counterparty|beneficiary|merchant|name/i,
};

/** Best-effort mapping from headers and a few sample rows; the user confirms it. */
export function guessMapping(
  headers: readonly string[],
  samples: readonly string[][],
): BankMapping {
  const find = (re: RegExp, except: number[] = []) =>
    headers.findIndex((h, i) => !except.includes(i) && re.test(h.trim()));
  let dateColumn = find(HEADER_HINTS.date);
  if (dateColumn < 0) {
    dateColumn = headers.findIndex((_, i) =>
      samples.some((r) => DATE_FORMATS.some((f) => parseBankDate(r[i] ?? "", f))),
    );
  }
  const debitColumn = find(HEADER_HINTS.debit);
  const creditColumn = find(HEADER_HINTS.credit);
  const amountColumn = find(HEADER_HINTS.amount, [debitColumn, creditColumn]);
  const descriptionColumn = find(HEADER_HINTS.description);
  const counterpartyColumn = find(HEADER_HINTS.counterparty, [descriptionColumn]);
  const dateSamples = samples.map((r) => r[Math.max(0, dateColumn)] ?? "").filter(Boolean);
  // The format that reads the most samples (a stray bad line doesn't decide it); ties → list order.
  let dateFormat: DateFormat = "yyyy-MM-dd";
  let best = 0;
  for (const f of DATE_FORMATS) {
    const n = dateSamples.filter((d) => parseBankDate(d, f)).length;
    if (n > best) {
      best = n;
      dateFormat = f;
    }
  }
  const twoColumns = debitColumn >= 0 && creditColumn >= 0 && amountColumn < 0;
  return {
    hasHeader: true,
    dateColumn: Math.max(0, dateColumn),
    dateFormat,
    descriptionColumn: descriptionColumn >= 0 ? descriptionColumn : Math.min(1, headers.length - 1),
    counterpartyColumn: counterpartyColumn >= 0 ? counterpartyColumn : null,
    amountMode: twoColumns ? "debit_credit" : "signed",
    amountColumn: twoColumns
      ? null
      : amountColumn >= 0
        ? amountColumn
        : Math.min(2, headers.length - 1),
    debitColumn: twoColumns ? debitColumn : null,
    creditColumn: twoColumns ? creditColumn : null,
    negate: false,
  };
}

/** Applies the mapping: good rows and per-line errors (zero amounts are errors, not rows). */
export function normalizeBankRows(
  table: readonly string[][],
  mapping: BankMapping,
  currency: string,
): { rows: BankRow[]; errors: BankRowError[] } {
  const rows: BankRow[] = [];
  const errors: BankRowError[] = [];
  const start = mapping.hasHeader ? 1 : 0;
  for (let i = start; i < table.length; i++) {
    const r = table[i]!;
    const line = i + 1;
    const cell = (c: number | null) => (c === null ? "" : (r[c] ?? "").trim());
    const date = parseBankDate(cell(mapping.dateColumn), mapping.dateFormat);
    if (!date) {
      errors.push({
        line,
        message: `Date "${cell(mapping.dateColumn)}" does not match ${mapping.dateFormat}`,
      });
      continue;
    }
    let amount: number | null;
    try {
      if (mapping.amountMode === "signed") {
        const v = parseBankAmount(cell(mapping.amountColumn), currency);
        amount = v === null ? null : mapping.negate ? -v : v;
      } else {
        const debit = parseBankAmount(cell(mapping.debitColumn), currency);
        const credit = parseBankAmount(cell(mapping.creditColumn), currency);
        amount = debit === null && credit === null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
      }
    } catch {
      errors.push({ line, message: "Amount is not a number" });
      continue;
    }
    if (amount === null || amount === 0) {
      errors.push({ line, message: "No amount" });
      continue;
    }
    const description = cell(mapping.descriptionColumn).replace(/\s+/g, " ");
    rows.push({
      line,
      date,
      amountMinor: amount,
      description: description || "(no description)",
      counterparty: cell(mapping.counterpartyColumn) || null,
    });
  }
  return { rows, errors };
}

export const normalizeDescription = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Dedupe keys: account | date | amount | description | n, where n counts identical rows earlier in
 * the same file — two genuine identical rows both import, and the same file again gives the same keys.
 */
export function bankRowKeys(accountId: string, rows: readonly BankRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${accountId}|${r.date}|${r.amountMinor}|${normalizeDescription(r.description)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}
