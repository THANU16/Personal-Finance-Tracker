// docs/07 — Money Manager (Realbyte) Excel import: normalise, pair, classify and plan postings. Pure (no DB);
// amounts are integer minor units parsed from the cell's decimal string, never via floats.
import { createHash } from "node:crypto";
import { minorUnitDigits } from "@/domain/money";

export const MM_SOURCE = "money_manager";
/** Required leading columns of a Money Manager export (the last "Accounts" duplicate is ignored). */
export const MM_COLUMNS = [
  "Period",
  "Accounts",
  "Category",
  "Subcategory",
  "Note",
  "LKR",
  "Income/Expense",
  "Description",
  "Amount",
  "Currency",
] as const;
export const MM_TYPES = ["Exp.", "Income", "Transfer-Out", "Transfer-In"] as const;
export type MmType = (typeof MM_TYPES)[number];

// ---------------------------------------------------------------------------------- normalise

/** Trim and collapse inner whitespace. */
export function cleanName(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Case/space-insensitive key for merging variants ("Cash In Hand " = "cash in hand"). */
export function nameKey(s: string | null | undefined): string {
  return cleanName(s).toLowerCase();
}

const EMOJI =
  /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic})|\p{Emoji_Modifier}|\p{Regional_Indicator})*)\s*/u;

/** "🍜 Food" → { icon: "🍜", name: "Food" }; names without a leading emoji are unchanged. */
export function splitEmoji(raw: string): { icon: string | null; name: string } {
  const s = cleanName(raw);
  const m = EMOJI.exec(s);
  if (!m) return { icon: null, name: s };
  const name = cleanName(s.slice(m[0].length));
  return name ? { icon: m[1]!, name } : { icon: null, name: s };
}

/**
 * Decimal string → minor units, rounding half away from zero beyond the currency's digits. Accepts
 * "1234.5", "1,234.50", "1234.4999999999998" (Excel's stored double) — never parses through floats.
 */
export function parseAmountMinor(text: string, currency: string): number | null {
  const s = text.replace(/,/g, "").trim();
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const digits = minorUnitDigits(currency);
  const frac = (m[3] ?? "").padEnd(digits + 1, "0");
  let minor = BigInt(m[2]! + frac.slice(0, digits));
  if (Number(frac[digits]) >= 5) minor += 1n;
  const value = Number(minor);
  if (!Number.isSafeInteger(value)) return null;
  return m[1] === "-" ? -value : value;
}

export interface RawRow {
  /** 0-based file order of the upload. */
  file: number;
  /** 1-based data row within the file (header excluded). */
  rowIndex: number;
  /** Cell value of Period: a Date (wall clock stored as UTC fields) or text. */
  period: Date | string | null;
  account: string;
  category: string;
  subcategory: string;
  note: string;
  type: string;
  description: string;
  amountText: string;
  currency: string;
}

export interface MmRow {
  id: string;
  file: number;
  rowIndex: number;
  /** Wall-clock timestamp as recorded in Money Manager, `YYYY-MM-DDTHH:mm:ss`. */
  wallClock: string;
  /** Business date (wall-clock date). */
  date: string;
  type: MmType | null;
  account: string;
  accountKey: string;
  category: string;
  categoryIcon: string | null;
  categoryKey: string;
  subcategory: string;
  subcategoryIcon: string | null;
  subcategoryKey: string;
  note: string;
  description: string;
  amountMinor: number;
  currency: string;
  /** Problems that block posting the row (it can still be skipped). */
  problems: string[];
  occurrence: number;
  hash: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function wallClockOf(v: Date | string | null): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel stores date-times as day fractions: 12:30:00 can read back as 12:29:59.999. Round to the
    // second, or transfers and fees (matched "to the second") would not pair.
    v = new Date(Math.round(v.getTime() / 1000) * 1000);
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
  }
  return null;
}

export function importHash(parts: {
  wallClock: string;
  accountKey: string;
  categoryKey: string;
  subcategoryKey: string;
  type: string;
  amountMinor: number;
  note: string;
  occurrence: number;
}): string {
  const input = [
    MM_SOURCE,
    parts.wallClock,
    parts.accountKey,
    parts.categoryKey,
    parts.subcategoryKey,
    parts.type,
    String(parts.amountMinor),
    parts.note.toLowerCase(),
    String(parts.occurrence),
  ].join("|");
  return createHash("sha1").update(input).digest("hex");
}

/**
 * Normalises one file's rows: trimmed names, emoji split, minor units, wall-clock time, problems
 * (bad date, zero/invalid amount, unknown type, future date) and a stable hash with an occurrence
 * index so identical rows inside one file stay distinct.
 */
export function normaliseRows(
  raw: readonly RawRow[],
  opts: { todayKey: string; baseCurrency: string },
): MmRow[] {
  const seen = new Map<string, number>();
  return raw.map((r) => {
    const problems: string[] = [];
    const wallClock = wallClockOf(r.period);
    if (!wallClock) problems.push("Unreadable date");
    const type = (MM_TYPES as readonly string[]).includes(cleanName(r.type))
      ? (cleanName(r.type) as MmType)
      : null;
    if (!type) problems.push(`Unknown row type "${cleanName(r.type)}"`);
    const currency = cleanName(r.currency).toUpperCase() || opts.baseCurrency;
    let amountMinor = 0;
    try {
      amountMinor = parseAmountMinor(r.amountText, currency) ?? 0;
      if (!/^[+-]?[\d,]+(\.\d+)?$/.test(r.amountText.trim())) problems.push("Unreadable amount");
    } catch {
      problems.push(`Unknown currency "${currency}"`);
    }
    if (currency !== opts.baseCurrency && !problems.some((p) => p.startsWith("Unknown currency"))) {
      problems.push(
        `In ${currency}, not ${opts.baseCurrency} (foreign-currency rows need FX; skip or convert them)`,
      );
    }
    if (amountMinor < 0) amountMinor = -amountMinor;
    if (amountMinor === 0 && !problems.length) problems.push("Zero amount");
    const date = wallClock ? wallClock.slice(0, 10) : "";
    if (date && date > opts.todayKey) problems.push("Dated in the future");
    const cat = splitEmoji(r.category);
    const sub = splitEmoji(r.subcategory);
    const base = {
      wallClock: wallClock ?? "",
      accountKey: nameKey(r.account),
      categoryKey: nameKey(cat.name),
      subcategoryKey: nameKey(sub.name),
      type: type ?? cleanName(r.type),
      amountMinor,
      note: cleanName(r.note),
    };
    const dupKey = JSON.stringify(base);
    const occurrence = seen.get(dupKey) ?? 0;
    seen.set(dupKey, occurrence + 1);
    return {
      id: `${r.file}:${r.rowIndex}`,
      file: r.file,
      rowIndex: r.rowIndex,
      wallClock: wallClock ?? "",
      date,
      type,
      account: cleanName(r.account),
      accountKey: base.accountKey,
      category: cat.name,
      categoryIcon: cat.icon,
      categoryKey: base.categoryKey,
      subcategory: sub.name,
      subcategoryIcon: sub.icon,
      subcategoryKey: base.subcategoryKey,
      note: base.note,
      description: cleanName(r.description),
      amountMinor,
      currency,
      problems,
      occurrence,
      hash: importHash({ ...base, occurrence }),
    };
  });
}

/**
 * Merges files into one chronological list. Within one timestamp a file's own order is kept
 * (Money Manager exports newest first, so its order is reversed for ties). A row whose hash already
 * came from an earlier file is a cross-file duplicate and is dropped.
 */
export function mergeFiles(files: readonly MmRow[][]): { rows: MmRow[]; duplicates: MmRow[] } {
  const ordered = files.map((rows) => {
    const dated = rows.filter((r) => r.wallClock);
    const newestFirst = dated.length > 1 && dated[0]!.wallClock > dated.at(-1)!.wallClock;
    return newestFirst ? [...rows].reverse() : [...rows];
  });
  const seq = new Map<string, number>();
  ordered.forEach((rows, f) => rows.forEach((r, i) => seq.set(r.id, f * 1_000_000 + i)));
  const all = ordered
    .flat()
    .sort((a, b) => a.wallClock.localeCompare(b.wallClock) || seq.get(a.id)! - seq.get(b.id)!);
  const firstFile = new Map<string, number>();
  const rows: MmRow[] = [];
  const duplicates: MmRow[] = [];
  for (const r of all) {
    const f = firstFile.get(r.hash);
    if (f !== undefined && f !== r.file) {
      duplicates.push(r);
      continue;
    }
    firstFile.set(r.hash, r.file);
    rows.push(r);
  }
  return { rows, duplicates };
}

// ------------------------------------------------------------------------- pair, attach, classify

export interface TransferPair {
  out: MmRow;
  in: MmRow;
  fee: MmRow | null;
}

/** Transfer-Out ↔ Transfer-In on (time, amount, out.account = in.category, out.category = in.account). */
export function pairTransfers(rows: readonly MmRow[]): {
  pairs: TransferPair[];
  unpaired: MmRow[];
} {
  const ok = (r: MmRow) => r.problems.length === 0;
  const ins = new Map<string, MmRow[]>();
  for (const r of rows) {
    if (r.type !== "Transfer-In" || !ok(r)) continue;
    const key = `${r.wallClock}|${r.amountMinor}|${r.categoryKey}|${r.accountKey}`;
    ins.set(key, [...(ins.get(key) ?? []), r]);
  }
  const pairs: TransferPair[] = [];
  const unpaired: MmRow[] = [];
  for (const r of rows) {
    if (r.type !== "Transfer-Out" || !ok(r)) continue;
    const key = `${r.wallClock}|${r.amountMinor}|${r.accountKey}|${r.categoryKey}`;
    const match = ins.get(key)?.shift();
    if (match) pairs.push({ out: r, in: match, fee: null });
    else unpaired.push(r);
  }
  for (const list of ins.values()) unpaired.push(...list);
  return { pairs, unpaired: unpaired.sort((a, b) => a.wallClock.localeCompare(b.wallClock)) };
}

export const isFeeRow = (r: MmRow) => r.type === "Exp." && r.note.toLowerCase() === "fees";
export const isDifferenceRow = (r: MmRow) =>
  (r.type === "Exp." || r.type === "Income") && r.note.toLowerCase() === "difference";

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );

/** Word overlap (Jaccard) between the fee's destination text and a transfer's destination. */
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  return inter / (x.size + y.size - inter);
}

/** "Bank A → Give to frds" → "Give to frds" (text after the last arrow; whole text otherwise). */
export function feeDestination(description: string): string {
  const parts = description.split(/→|->|=>/);
  return cleanName(parts.at(-1));
}

/**
 * Attaches each fee to the transfer-out from the same account at the same second; with several
 * candidates the one whose destination best matches the fee description wins (a tie is ambiguous).
 * Fees that stay unattached become standalone "Bank fees" expenses.
 */
export function attachFees(
  pairs: TransferPair[],
  fees: readonly MmRow[],
): { attached: TransferPair[]; standalone: MmRow[]; ambiguous: MmRow[] } {
  const standalone: MmRow[] = [];
  const ambiguous: MmRow[] = [];
  for (const fee of fees) {
    const candidates = pairs.filter(
      (p) => !p.fee && p.out.accountKey === fee.accountKey && p.out.wallClock === fee.wallClock,
    );
    if (candidates.length === 0) {
      standalone.push(fee);
      continue;
    }
    if (candidates.length === 1) {
      candidates[0]!.fee = fee;
      continue;
    }
    const dest = feeDestination(fee.description);
    const scored = candidates
      .map((p) => ({ p, s: similarity(dest, p.out.category) }))
      .sort((a, b) => b.s - a.s);
    if (scored[0]!.s > 0 && scored[0]!.s > scored[1]!.s) scored[0]!.p.fee = fee;
    else {
      ambiguous.push(fee);
      standalone.push(fee);
    }
  }
  return { attached: pairs.filter((p) => p.fee), standalone, ambiguous };
}

export type RowKind = "expense" | "income" | "transfer" | "fee" | "difference" | "problem";

export interface Classified {
  rows: MmRow[];
  pairs: TransferPair[];
  /** Fees not attached to a transfer (standalone "Bank fees" expenses). */
  standaloneFees: MmRow[];
  ambiguousFees: MmRow[];
  differences: MmRow[];
  expenses: MmRow[];
  incomes: MmRow[];
  /** Rows with problems or unpaired transfer halves. */
  problems: { row: MmRow; reason: string }[];
  kindOf: Map<string, RowKind>;
}

export function classifyRows(rows: readonly MmRow[]): Classified {
  const problems: { row: MmRow; reason: string }[] = [];
  for (const r of rows)
    if (r.problems.length) problems.push({ row: r, reason: r.problems.join("; ") });
  const good = rows.filter((r) => r.problems.length === 0);
  const { pairs, unpaired } = pairTransfers(good);
  for (const r of unpaired) problems.push({ row: r, reason: "Transfer without its other half" });
  const fees = good.filter(isFeeRow);
  const { standalone, ambiguous } = attachFees(pairs, fees);
  const differences = good.filter(isDifferenceRow);
  const expenses = good.filter((r) => r.type === "Exp." && !isFeeRow(r) && !isDifferenceRow(r));
  const incomes = good.filter((r) => r.type === "Income" && !isDifferenceRow(r));
  const kindOf = new Map<string, RowKind>();
  for (const p of pairs) {
    kindOf.set(p.out.id, "transfer");
    kindOf.set(p.in.id, "transfer");
  }
  for (const f of fees) kindOf.set(f.id, "fee");
  for (const d of differences) kindOf.set(d.id, "difference");
  for (const e of expenses) kindOf.set(e.id, "expense");
  for (const i of incomes) kindOf.set(i.id, "income");
  for (const p of problems) kindOf.set(p.row.id, "problem");
  return {
    rows: [...rows],
    pairs,
    standaloneFees: standalone,
    ambiguousFees: ambiguous,
    differences,
    expenses,
    incomes,
    problems,
    kindOf,
  };
}

/** Money Manager's own running balance per account key: Income + Transfer-In − Exp. − Transfer-Out. */
export function signedBalances(rows: readonly MmRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.problems.length || !r.type) continue;
    const sign = r.type === "Income" || r.type === "Transfer-In" ? 1 : -1;
    out.set(r.accountKey, (out.get(r.accountKey) ?? 0) + sign * r.amountMinor);
  }
  return out;
}

// ------------------------------------------------------------------------------------- mapping

/** Where a Money Manager account goes. Refs are existing ids or "new:<key>" created at commit. */
export type AccountMapping =
  | { treatAs: "account"; ref: string }
  | { treatAs: "holding"; ref: string }
  | { treatAs: "ignore" }
  | { treatAs: "merge"; into: string };

export type CategoryMapping = { ref: string } | { merge: string } | { uncategorised: true };

export interface ImportMapping {
  accounts: Record<string, AccountMapping>;
  /** Keys: `categoryKey` for a category, `categoryKey>subcategoryKey` for a subcategory. */
  expenseCategories: Record<string, CategoryMapping>;
  incomeCategories: Record<string, CategoryMapping>;
  /** Rows to leave out (problem rows the user chose to skip, or any row id). */
  skipRowIds?: string[];
  /** Fees the user detached in the review (row ids) → standalone "Bank fees". */
  detachFeeIds?: string[];
}

export interface Target {
  kind: "account" | "holding";
  ref: string;
}

/** Resolves merges (with a cycle guard). */
export function resolveAccount(mapping: ImportMapping, key: string): Target | null {
  const seen = new Set<string>();
  let k = key;
  for (;;) {
    if (seen.has(k)) return null;
    seen.add(k);
    const m = mapping.accounts[k];
    if (!m || m.treatAs === "ignore") return null;
    if (m.treatAs === "merge") {
      k = m.into;
      continue;
    }
    return { kind: m.treatAs, ref: m.ref };
  }
}

export const categoryNodeKey = (r: Pick<MmRow, "categoryKey" | "subcategoryKey">) =>
  r.subcategoryKey ? `${r.categoryKey}>${r.subcategoryKey}` : r.categoryKey;

export const UNCATEGORISED = "uncategorised";

/** Category ref for a row: its subcategory node, else its category node; merges followed. */
export function resolveCategory(
  map: Record<string, CategoryMapping>,
  r: Pick<MmRow, "categoryKey" | "subcategoryKey">,
): string | null {
  const seen = new Set<string>();
  let k: string | null = categoryNodeKey(r);
  if (!map[k]) k = r.categoryKey;
  while (k !== null) {
    if (seen.has(k)) return null;
    seen.add(k);
    const m: CategoryMapping | undefined = map[k];
    if (!m) return null;
    if ("ref" in m) return m.ref;
    if ("uncategorised" in m) return UNCATEGORISED;
    k = m.merge;
  }
  return null;
}

// ------------------------------------------------------------------------------- posting plan

export type PlanOp =
  | {
      op: "expense";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      account: string;
      category: string;
      amountMinor: number;
      description: string;
      notes: string;
    }
  | {
      op: "income";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      account: string;
      category: string;
      amountMinor: number;
      description: string;
      notes: string;
    }
  | {
      op: "transfer";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      from: string;
      to: string;
      amountMinor: number;
      feeMinor: number;
      description: string;
    }
  | {
      op: "invest";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      from: string;
      holding: string;
      amountMinor: number;
      feeMinor: number;
      description: string;
      group?: string;
    }
  | {
      op: "redeem";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      holding: string;
      to: string | null;
      amountMinor: number;
      feeMinor: number;
      description: string;
      group?: string;
    }
  | {
      op: "adjustment";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      account: string;
      direction: "to" | "from";
      amountMinor: number;
      description: string;
    }
  | {
      op: "valuation";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      holding: string;
      valueMinor: number;
      reason: "difference" | "before_redeem";
    }
  | {
      op: "opening";
      rowIds: string[];
      hash: string;
      wallClock: string;
      date: string;
      holding: string;
      investedMinor: number;
    };

export interface PlanSkip {
  rowIds: string[];
  reason: string;
}

export interface PostingPlan {
  ops: PlanOp[];
  skipped: PlanSkip[];
  /** Expected balance per target account ref (opening + plan); compared with Money Manager. */
  accountBalances: Map<string, number>;
  /** Modelled value per holding ref after the plan. */
  holdingValues: Map<string, number>;
  /** First business date per target account ref (default opening date). */
  firstDates: Map<string, string>;
}

const fromBoth = (p: TransferPair) => [p.out.id, p.in.id, ...(p.fee ? [p.fee.id] : [])];
const pairHash = (p: TransferPair) =>
  createHash("sha1").update(`${p.out.hash}|${p.in.hash}`).digest("hex");

/**
 * Ordered ledger operations per docs/07 §4. Holdings mirror Money Manager's balance: invest adds the
 * amount, redeem removes it, a Difference row sets the value to the running balance (an empty
 * holding gets an opening instead). A redeem larger than the modelled value is preceded by a
 * valuation equal to the amount (owner decision) so the redemption is full, not refused.
 */
export function buildPostingPlan(
  c: Classified,
  mapping: ImportMapping,
  openings: Record<string, number> = {},
  /** Existing holdings continued by a later file: their value and invested before the first row. */
  holdingStart: Record<string, { valueMinor: number; investedMinor: number }> = {},
): PostingPlan {
  const skip = new Set(mapping.skipRowIds ?? []);
  const detach = new Set(mapping.detachFeeIds ?? []);
  const ops: PlanOp[] = [];
  const skipped: PlanSkip[] = [];
  const balances = new Map<string, number>(Object.entries(openings));
  const values = new Map<string, number>(
    Object.entries(holdingStart).map(([k, v]) => [k, v.valueMinor]),
  );
  const invested = new Map<string, number>(
    Object.entries(holdingStart).map(([k, v]) => [k, v.investedMinor]),
  );
  const firstDates = new Map<string, string>();
  const bump = (ref: string, delta: number) => balances.set(ref, (balances.get(ref) ?? 0) + delta);
  const seenDate = (ref: string, date: string) => {
    const d = firstDates.get(ref);
    if (!d || date < d) firstDates.set(ref, date);
  };

  type Event = { at: string; order: number; run: () => void };
  const events: Event[] = [];
  const order = new Map(c.rows.map((r, i) => [r.id, i]));
  const push = (row: MmRow, run: () => void) =>
    events.push({ at: row.wallClock, order: order.get(row.id) ?? 0, run });

  const standaloneFees = new Set(c.standaloneFees.map((f) => f.id));
  for (const p of c.pairs) {
    if (p.fee && detach.has(p.fee.id)) {
      standaloneFees.add(p.fee.id);
      p.fee = null;
    }
  }
  const feeRows = new Map(c.rows.filter(isFeeRow).map((f) => [f.id, f]));

  for (const p of c.pairs) {
    push(p.out, () => {
      const ids = fromBoth(p);
      if (ids.some((id) => skip.has(id)))
        return skipped.push({ rowIds: ids, reason: "Skipped by you" });
      const from = resolveAccount(mapping, p.out.accountKey);
      const to = resolveAccount(mapping, p.in.accountKey);
      const amount = p.out.amountMinor;
      const fee = p.fee?.amountMinor ?? 0;
      const base = {
        rowIds: ids,
        wallClock: p.out.wallClock,
        date: p.out.date,
        description: p.out.note || "Transfer",
      };
      if (!from || !to)
        return skipped.push({ rowIds: ids, reason: "One side is an ignored account" });
      if (from.ref === to.ref) {
        // The move itself vanishes, but an attached fee was still paid: keep it as a "Bank fees" expense.
        if (p.fee && from.kind === "account") {
          seenDate(from.ref, base.date);
          ops.push({
            op: "expense",
            rowIds: [p.fee.id],
            hash: p.fee.hash,
            wallClock: p.fee.wallClock,
            date: p.fee.date,
            account: from.ref,
            category: "system:bank_fees",
            amountMinor: fee,
            description: p.fee.description || "Fees",
            notes: "",
          });
          bump(from.ref, -fee);
        }
        return skipped.push({
          rowIds: [p.out.id, p.in.id],
          reason: "Both sides map to the same place",
        });
      }
      if (from.kind === "account" && to.kind === "account") {
        seenDate(from.ref, base.date);
        seenDate(to.ref, base.date);
        ops.push({
          op: "transfer",
          ...base,
          hash: pairHash(p),
          from: from.ref,
          to: to.ref,
          amountMinor: amount,
          feeMinor: fee,
        });
        bump(from.ref, -(amount + fee));
        bump(to.ref, amount);
      } else if (from.kind === "account" && to.kind === "holding") {
        seenDate(from.ref, base.date);
        ops.push({
          op: "invest",
          ...base,
          hash: pairHash(p),
          from: from.ref,
          holding: to.ref,
          amountMinor: amount,
          feeMinor: fee,
        });
        bump(from.ref, -(amount + fee));
        values.set(to.ref, (values.get(to.ref) ?? 0) + amount);
        invested.set(to.ref, (invested.get(to.ref) ?? 0) + amount + fee);
      } else if (from.kind === "holding" && to.kind === "account") {
        seenDate(to.ref, base.date);
        const gross = amount + fee;
        const value = values.get(from.ref) ?? 0;
        if (gross > value) {
          ops.push({
            op: "valuation",
            ...base,
            hash: `${pairHash(p)}:value`,
            holding: from.ref,
            valueMinor: gross,
            reason: "before_redeem",
          });
          values.set(from.ref, gross);
        }
        ops.push({
          op: "redeem",
          ...base,
          hash: pairHash(p),
          holding: from.ref,
          to: to.ref,
          amountMinor: gross,
          feeMinor: fee,
        });
        values.set(from.ref, (values.get(from.ref) ?? 0) - gross);
        bump(to.ref, amount);
      } else {
        const group = `g:${p.out.id}`;
        const gross = amount + fee;
        const value = values.get(from.ref) ?? 0;
        if (gross > value) {
          ops.push({
            op: "valuation",
            ...base,
            hash: `${pairHash(p)}:value`,
            holding: from.ref,
            valueMinor: gross,
            reason: "before_redeem",
          });
          values.set(from.ref, gross);
        }
        ops.push({
          op: "redeem",
          ...base,
          hash: `${pairHash(p)}:out`,
          holding: from.ref,
          to: null,
          amountMinor: gross,
          feeMinor: fee,
          group,
        });
        ops.push({
          op: "invest",
          ...base,
          hash: `${pairHash(p)}:in`,
          from: "",
          holding: to.ref,
          amountMinor: amount,
          feeMinor: 0,
          group,
        });
        values.set(from.ref, (values.get(from.ref) ?? 0) - gross);
        values.set(to.ref, (values.get(to.ref) ?? 0) + amount);
        invested.set(to.ref, (invested.get(to.ref) ?? 0) + amount);
      }
    });
  }

  for (const id of standaloneFees) {
    const f = feeRows.get(id)!;
    push(f, () => {
      if (skip.has(f.id)) return skipped.push({ rowIds: [f.id], reason: "Skipped by you" });
      const t = resolveAccount(mapping, f.accountKey);
      if (!t) return skipped.push({ rowIds: [f.id], reason: "Ignored account" });
      if (t.kind !== "account")
        return skipped.push({ rowIds: [f.id], reason: "Fee on a holding without a transfer" });
      seenDate(t.ref, f.date);
      ops.push({
        op: "expense",
        rowIds: [f.id],
        hash: f.hash,
        wallClock: f.wallClock,
        date: f.date,
        account: t.ref,
        category: "system:bank_fees",
        amountMinor: f.amountMinor,
        description: f.description || "Fees",
        notes: "",
      });
      bump(t.ref, -f.amountMinor);
    });
  }

  for (const r of [...c.expenses, ...c.incomes]) {
    push(r, () => {
      if (skip.has(r.id)) return skipped.push({ rowIds: [r.id], reason: "Skipped by you" });
      const t = resolveAccount(mapping, r.accountKey);
      if (!t) return skipped.push({ rowIds: [r.id], reason: "Ignored account" });
      if (t.kind !== "account") {
        return skipped.push({
          rowIds: [r.id],
          reason: "Income or expense on an account mapped to a holding",
        });
      }
      const income = r.type === "Income";
      const category = resolveCategory(
        income ? mapping.incomeCategories : mapping.expenseCategories,
        r,
      );
      if (!category) return skipped.push({ rowIds: [r.id], reason: "Category not mapped" });
      seenDate(t.ref, r.date);
      ops.push({
        op: income ? "income" : "expense",
        rowIds: [r.id],
        hash: r.hash,
        wallClock: r.wallClock,
        date: r.date,
        account: t.ref,
        category,
        amountMinor: r.amountMinor,
        description: r.note || r.subcategory || r.category,
        notes: r.description,
      });
      bump(t.ref, income ? r.amountMinor : -r.amountMinor);
    });
  }

  for (const d of c.differences) {
    push(d, () => {
      if (skip.has(d.id)) return skipped.push({ rowIds: [d.id], reason: "Skipped by you" });
      const t = resolveAccount(mapping, d.accountKey);
      if (!t) return skipped.push({ rowIds: [d.id], reason: "Ignored account" });
      const up = d.type === "Income";
      const base = { rowIds: [d.id], hash: d.hash, wallClock: d.wallClock, date: d.date };
      if (t.kind === "account") {
        seenDate(t.ref, d.date);
        ops.push({
          op: "adjustment",
          ...base,
          account: t.ref,
          direction: up ? "to" : "from",
          amountMinor: d.amountMinor,
          description: "Money Manager balance difference",
        });
        bump(t.ref, up ? d.amountMinor : -d.amountMinor);
        return;
      }
      const before = values.get(t.ref) ?? 0;
      const after = Math.max(0, before + (up ? d.amountMinor : -d.amountMinor));
      if (before === 0 && (invested.get(t.ref) ?? 0) === 0 && up) {
        ops.push({ op: "opening", ...base, holding: t.ref, investedMinor: after });
        invested.set(t.ref, after);
      }
      ops.push({
        op: "valuation",
        ...base,
        hash: `${d.hash}:value`,
        holding: t.ref,
        valueMinor: after,
        reason: "difference",
      });
      values.set(t.ref, after);
    });
  }

  for (const p of c.problems) skipped.push({ rowIds: [p.row.id], reason: p.reason });

  events.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
  for (const e of events) e.run();
  return { ops, skipped, accountBalances: balances, holdingValues: values, firstDates };
}

/** Expected Money Manager balance per target account ref (merged accounts summed; ignored left out). */
export function mmBalancesByTarget(
  rows: readonly MmRow[],
  mapping: ImportMapping,
  openings: Record<string, number> = {},
): Map<string, number> {
  const out = new Map<string, number>(Object.entries(openings));
  for (const [key, bal] of signedBalances(rows)) {
    const t = resolveAccount(mapping, key);
    if (t?.kind === "account") out.set(t.ref, (out.get(t.ref) ?? 0) + bal);
  }
  return out;
}

// ------------------------------------------------------------------------------- suggestions

export interface AccountSummary {
  key: string;
  name: string;
  rows: number;
  inMinor: number;
  outMinor: number;
  firstDate: string;
  lastDate: string;
  currency: string;
  hasDifference: boolean;
}

export function summariseAccounts(rows: readonly MmRow[]): AccountSummary[] {
  const map = new Map<string, AccountSummary & { names: Map<string, number> }>();
  for (const r of rows) {
    if (!r.accountKey) continue;
    const s =
      map.get(r.accountKey) ??
      ({
        key: r.accountKey,
        name: r.account,
        rows: 0,
        inMinor: 0,
        outMinor: 0,
        firstDate: r.date,
        lastDate: r.date,
        currency: r.currency,
        hasDifference: false,
        names: new Map(),
      } as AccountSummary & { names: Map<string, number> });
    s.rows += 1;
    if (r.type === "Income" || r.type === "Transfer-In") s.inMinor += r.amountMinor;
    else s.outMinor += r.amountMinor;
    if (r.date && (!s.firstDate || r.date < s.firstDate)) s.firstDate = r.date;
    if (r.date > s.lastDate) s.lastDate = r.date;
    if (isDifferenceRow(r)) s.hasDifference = true;
    s.names.set(r.account, (s.names.get(r.account) ?? 0) + 1);
    map.set(r.accountKey, s);
  }
  return [...map.values()]
    .map(({ names, ...s }) => ({
      ...s,
      name: [...names.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}

export type SuggestedAccount =
  | { treatAs: "account"; type: "bank" | "cash" | "wallet" | "receivable" | "payable" }
  | {
      treatAs: "holding";
      assetClass: "Equity" | "Fixed Income" | "Crypto";
      instrument: "unit_trust" | "stock" | "crypto" | "mutual_fund";
    };

/** docs/07 §3 heuristics (defaults only — the user can change everything). */
export function suggestAccount(name: string): SuggestedAccount {
  const n = name.toLowerCase();
  if (/\bgive to\b/.test(n)) return { treatAs: "account", type: "receivable" };
  if (/\bfrom\b/.test(n)) return { treatAs: "account", type: "payable" };
  if (/binance|crypto|bitcoin|btc/.test(n))
    return { treatAs: "holding", assetClass: "Crypto", instrument: "crypto" };
  if (/fixed|money market|bond|treasury|gilt/.test(n))
    return { treatAs: "holding", assetClass: "Fixed Income", instrument: "unit_trust" };
  if (/cds|equity|stock|share/.test(n))
    return { treatAs: "holding", assetClass: "Equity", instrument: "stock" };
  if (/fund/.test(n))
    return { treatAs: "holding", assetClass: "Equity", instrument: "mutual_fund" };
  if (/cash/.test(n)) return { treatAs: "account", type: "cash" };
  if (/bank/.test(n)) return { treatAs: "account", type: "bank" };
  return { treatAs: "account", type: "wallet" };
}

export interface CategoryNode {
  key: string;
  name: string;
  icon: string | null;
  parentKey: string | null;
  rows: number;
  totalMinor: number;
}

/** Category tree (categories with their subcategories) of real expenses or incomes. */
export function categoryTree(rows: readonly MmRow[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  for (const r of rows) {
    const parent = map.get(r.categoryKey) ?? {
      key: r.categoryKey,
      name: r.category || "Uncategorised",
      icon: r.categoryIcon,
      parentKey: null,
      rows: 0,
      totalMinor: 0,
    };
    parent.rows += 1;
    parent.totalMinor += r.amountMinor;
    map.set(r.categoryKey, parent);
    if (r.subcategoryKey) {
      const k = categoryNodeKey(r);
      const child = map.get(k) ?? {
        key: k,
        name: r.subcategory,
        icon: r.subcategoryIcon,
        parentKey: r.categoryKey,
        rows: 0,
        totalMinor: 0,
      };
      child.rows += 1;
      child.totalMinor += r.amountMinor;
      map.set(k, child);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      (a.parentKey ?? a.key).localeCompare(b.parentKey ?? b.key) ||
      (a.parentKey ? 1 : -1) ||
      a.name.localeCompare(b.name),
  );
}

/** Hints for likely duplicates ("Petrol" ≈ "Bike → Petrol"): a category name equal to another's subcategory. */
export function mergeHints(nodes: readonly CategoryNode[]): { from: string; to: string }[] {
  const subs = nodes.filter((n) => n.parentKey);
  return nodes
    .filter((n) => !n.parentKey)
    .flatMap((n) =>
      subs
        .filter((s) => s.name.toLowerCase() === n.name.toLowerCase() && s.parentKey !== n.key)
        .map((s) => ({ from: n.key, to: s.key })),
    );
}
