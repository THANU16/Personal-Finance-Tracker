// Valuation history CSV import (docs/04 §23). Pure and browser-safe (the import preview recalculates
// live): no DB, no Node APIs. The sha256 import hash is computed on the server.
import { daysBetween } from "@/domain/fd";
import { holdingCashFlows, replayHolding, type HoldingEvent } from "@/domain/holdings";
import { minorUnitDigits, parseScaledDecimal } from "@/domain/money";
import { xirrBp } from "@/domain/returns";

export const CSV_HEADER = [
  "valuation date",
  "recorded at (utc)",
  "value",
  "units",
  "nav",
  "price per unit",
  "currency",
  "note",
] as const;

export const DEFAULT_JUMP_THRESHOLD_BP = 1000;
/** "A whole multiple of 1,000" in major units. */
export const ROUND_STEP_MAJOR = 1000;

export interface CsvRow {
  /** 1-based data row number in the file (header excluded). */
  line: number;
  date: string;
  /** ISO instant `YYYY-MM-DDTHH:mm:ssZ`, or null when the column is empty. */
  recordedAt: string | null;
  valueMinor: number;
  units: number | null;
  navMinorE4: number | null;
  priceMinorE4: number | null;
  currency: string;
  note: string;
  errors: string[];
}

export interface ParseResult {
  rows: CsvRow[];
  /** Set when the file is not a valuation export at all (wrong header). */
  fileError: string | null;
}

/** Splits one CSV line on commas outside double quotes ("" is an escaped quote). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const isDateKey = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function parseRecordedAt(text: string): string | null | undefined {
  if (!text) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!m || !isDateKey(m[1]!)) return undefined;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** "1,234.50" / "\"338,738.45\"" → scaled integer; null when empty; throws on junk. */
function scaled(text: string, digits: number): number | null {
  return parseScaledDecimal(text.replace(/^"|"$/g, ""), digits);
}

/**
 * Parses a valuation export: tolerates a UTF-8 BOM, CRLF, blank lines and quoted numbers with
 * thousands separators. Values are parsed from their decimal text (never floats). Rows that cannot
 * be read keep their line number and an error.
 */
export function parseValuationCsv(text: string, fallbackCurrency: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const headerIndex = lines.findIndex((l) => l.trim() !== "");
  if (headerIndex < 0) return { rows: [], fileError: "The file is empty" };
  const header = splitCsvLine(lines[headerIndex]!).map((h) => h.toLowerCase());
  const col = (name: (typeof CSV_HEADER)[number]) => header.indexOf(name);
  if (col("valuation date") < 0 || col("value") < 0) {
    return { rows: [], fileError: `Expected the columns ${CSV_HEADER.join(", ")}` };
  }
  const rows: CsvRow[] = [];
  let line = 0;
  for (const raw of lines.slice(headerIndex + 1)) {
    if (raw.trim() === "") continue;
    line += 1;
    const cells = splitCsvLine(raw);
    const get = (name: (typeof CSV_HEADER)[number]) =>
      col(name) >= 0 ? (cells[col(name)] ?? "") : "";
    const errors: string[] = [];
    const date = get("valuation date");
    if (!isDateKey(date)) errors.push(`Unreadable date "${date}"`);
    const recorded = parseRecordedAt(get("recorded at (utc)"));
    if (recorded === undefined)
      errors.push(`Unreadable recorded time "${get("recorded at (utc)")}"`);
    const currency = (get("currency") || fallbackCurrency).toUpperCase();
    let digits = 2;
    try {
      digits = minorUnitDigits(currency);
    } catch {
      errors.push(`Unknown currency "${currency}"`);
    }
    let valueMinor = 0;
    let units: number | null = null;
    let navMinorE4: number | null = null;
    let priceMinorE4: number | null = null;
    try {
      const v = scaled(get("value"), digits);
      if (v === null) errors.push("Missing value");
      else valueMinor = v;
    } catch {
      errors.push(`Unreadable value "${get("value")}"`);
    }
    try {
      const u = get("units").replace(/^"|"$/g, "").replace(/,/g, "");
      if (u) {
        units = Number(u);
        if (!Number.isFinite(units)) throw new Error();
      }
      navMinorE4 = scaled(get("nav"), digits + 4);
      priceMinorE4 = scaled(get("price per unit"), digits + 4);
    } catch {
      errors.push("Unreadable units / NAV / price");
    }
    rows.push({
      line,
      date,
      recordedAt: recorded ?? null,
      valueMinor,
      units,
      navMinorE4,
      priceMinorE4,
      currency,
      note: get("note"),
      errors,
    });
  }
  return { rows, fileError: rows.length ? null : "The file has no rows" };
}

/** Rule 1: date not in the future, value ≥ 0, currency = the holding's. */
export function validateRows(
  rows: readonly CsvRow[],
  opts: { todayKey: string; currency: string },
): CsvRow[] {
  return rows.map((r) => {
    const errors = [...r.errors];
    if (isDateKey(r.date) && r.date > opts.todayKey) errors.push("Dated in the future");
    if (r.valueMinor < 0) errors.push("Negative value");
    if (r.currency !== opts.currency)
      errors.push(`In ${r.currency}, the holding is in ${opts.currency}`);
    return { ...r, errors };
  });
}

// ------------------------------------------------------------------------- file names

/** "<digits>_<Asset Name> - valuations_<YYYY-MM-DD>.csv" or "<Asset Name> - valuations <date>.csv". */
export function assetNameFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const m = /^(?:\d+_)?(.+?)\s*-\s*valuations[\s_]+\d{4}-\d{2}-\d{2}(?:\s*\(\d+\))?\.csv$/i.exec(
    base,
  );
  return (m ? m[1]! : base.replace(/\.csv$/i, "")).trim();
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Best holding for an asset name (case-insensitive, fuzzy); null below a 0.5 score. */
export function matchHolding<T extends { id: string; name: string }>(
  name: string,
  holdings: readonly T[],
): T | null {
  const want = tokens(name);
  if (!want.length) return null;
  let best: { h: T; score: number } | null = null;
  for (const h of holdings) {
    const have = tokens(h.name);
    const a = want.join(" ");
    const b = have.join(" ");
    let score: number;
    if (a === b) score = 1;
    else if (a && b && (a.includes(b) || b.includes(a))) score = 0.8;
    else {
      const setA = new Set(want);
      const inter = have.filter((t) => setA.has(t)).length;
      score = inter / new Set([...want, ...have]).size;
    }
    if (!best || score > best.score) best = { h, score };
  }
  return best && best.score >= 0.5 ? best.h : null;
}

// ---------------------------------------------------------------------- ordering & days

/** Rule 3: by date, then recorded time (rows without one last), then file order. */
export function orderRows<T extends Pick<CsvRow, "date" | "recordedAt" | "line">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.recordedAt ?? "9999").localeCompare(b.recordedAt ?? "9999") ||
      a.line - b.line,
  );
}

export interface DayEnd {
  date: string;
  /** The last recorded value of the day. */
  valueMinor: number;
  /** Lines of the day's rows in order (the last one is the day value). */
  lines: number[];
  values: number[];
}

/** Day-end value per date (ordered rows in). */
export function dayEnds(
  ordered: readonly Pick<CsvRow, "date" | "valueMinor" | "line">[],
): DayEnd[] {
  const out: DayEnd[] = [];
  for (const r of ordered) {
    const last = out.at(-1);
    if (last?.date === r.date) {
      last.lines.push(r.line);
      last.values.push(r.valueMinor);
      last.valueMinor = r.valueMinor;
    } else
      out.push({ date: r.date, valueMinor: r.valueMinor, lines: [r.line], values: [r.valueMinor] });
  }
  return out;
}

// ------------------------------------------------------------------------------ jumps

export type JumpAction = "deposit" | "withdrawal" | "market";

export interface Jump {
  key: string;
  fromDate: string;
  toDate: string;
  fromMinor: number;
  toMinor: number;
  changeMinor: number;
  /** Same-day steps that make up the change (previous day-end → each row of the later day). */
  stepsMinor: number[];
  reasons: ("percent" | "round")[];
  /** Default action and amount (rounded to 1,000.00), date = the later valuation's date. */
  action: JumpAction;
  amountMinor: number;
  date: string;
  alreadyRecorded: boolean;
}

export interface ExistingFlow {
  type: "invest" | "redeem";
  date: string;
  amountMinor: number;
}

/**
 * Rule 5: flag consecutive day-end changes with |change| ≥ threshold × previous value, or a
 * non-zero whole multiple of 1,000.00. A jump already recorded as an invest/redeem within ±3 days
 * with a similar amount defaults to a market move.
 */
export function detectJumps(
  days: readonly DayEnd[],
  opts: {
    thresholdBp: number;
    currency: string;
    existingFlows?: readonly ExistingFlow[];
    /** Skip jumps into a day that brings nothing new (all rows duplicates). */
    newDates?: ReadonlySet<string>;
  },
): Jump[] {
  const step = ROUND_STEP_MAJOR * 10 ** minorUnitDigits(opts.currency);
  const jumps: Jump[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1]!;
    const cur = days[i]!;
    if (opts.newDates && !opts.newDates.has(cur.date)) continue;
    const change = cur.valueMinor - prev.valueMinor;
    if (change === 0) continue;
    const reasons: Jump["reasons"] = [];
    if (Math.abs(change) * 10_000 >= opts.thresholdBp * Math.max(0, prev.valueMinor))
      reasons.push("percent");
    if (Math.abs(change) % step === 0) reasons.push("round");
    if (!reasons.length) continue;
    const rounded = Math.round(Math.abs(change) / step) * step || Math.abs(change);
    const action: JumpAction = change > 0 ? "deposit" : "withdrawal";
    const steps: number[] = [];
    let last = prev.valueMinor;
    for (const v of cur.values) {
      if (v !== last) steps.push(v - last);
      last = v;
    }
    const tolerance = Math.max(Math.round(Math.abs(change) * 0.02), step);
    const alreadyRecorded = (opts.existingFlows ?? []).some(
      (f) =>
        f.type === (action === "deposit" ? "invest" : "redeem") &&
        Math.abs(daysBetween(f.date, cur.date)) <= 3 &&
        Math.abs(f.amountMinor - rounded) <= tolerance,
    );
    jumps.push({
      key: `${prev.date}>${cur.date}`,
      fromDate: prev.date,
      toDate: cur.date,
      fromMinor: prev.valueMinor,
      toMinor: cur.valueMinor,
      changeMinor: change,
      stepsMinor: steps,
      reasons,
      action: alreadyRecorded ? "market" : action,
      amountMinor: rounded,
      date: cur.date,
      alreadyRecorded,
    });
  }
  return jumps;
}

// ------------------------------------------------------------------------------- plan

export interface JumpChoice {
  action: JumpAction;
  amountMinor: number;
  date: string;
}

export interface PlannedValuation {
  line: number;
  date: string;
  recordedAt: string | null;
  valueMinor: number;
  units: number | null;
  priceMinorE4: number | null;
  note: string;
  /** An earlier row of the same date (kept, not the day value). */
  superseded: boolean;
}

export interface PlannedFlow {
  type: "invest" | "redeem";
  date: string;
  amountMinor: number;
  /** Placed just before this instant (the first valuation of its date), or start of day. */
  beforeRecordedAt: string | null;
  reason: "initial" | "jump";
  jumpKey: string | null;
}

export interface ImportPlan {
  valuations: PlannedValuation[];
  flows: PlannedFlow[];
  depositMinor: number;
  withdrawalMinor: number;
}

/**
 * Valuations (every importable row) and flows (initial investment + chosen jump actions), in
 * chronological order. Rows with errors or duplicates are left out by the caller.
 */
export function buildImportPlan(input: {
  rows: readonly CsvRow[];
  jumps: readonly Jump[];
  choices: Readonly<Record<string, JumpChoice>>;
  firstAsInvestment: boolean;
  trackUnits: boolean;
}): ImportPlan {
  const ordered = orderRows(input.rows);
  const lastOfDay = new Map<string, number>();
  for (const r of ordered) lastOfDay.set(r.date, r.line);
  const valuations: PlannedValuation[] = ordered.map((r) => ({
    line: r.line,
    date: r.date,
    recordedAt: r.recordedAt,
    valueMinor: r.valueMinor,
    units: input.trackUnits ? r.units : null,
    priceMinorE4: input.trackUnits ? (r.priceMinorE4 ?? r.navMinorE4) : null,
    note: r.note,
    superseded: lastOfDay.get(r.date) !== r.line,
  }));
  const firstOn = (date: string) => valuations.find((v) => v.date === date)?.recordedAt ?? null;
  const flows: PlannedFlow[] = [];
  const first = valuations[0];
  if (input.firstAsInvestment && first && first.valueMinor > 0) {
    flows.push({
      type: "invest",
      date: first.date,
      amountMinor: first.valueMinor,
      beforeRecordedAt: first.recordedAt,
      reason: "initial",
      jumpKey: null,
    });
  }
  for (const j of input.jumps) {
    const c = input.choices[j.key] ?? {
      action: j.action,
      amountMinor: j.amountMinor,
      date: j.date,
    };
    if (c.action === "market" || c.amountMinor <= 0) continue;
    flows.push({
      type: c.action === "deposit" ? "invest" : "redeem",
      date: c.date,
      amountMinor: c.amountMinor,
      beforeRecordedAt: firstOn(c.date),
      reason: "jump",
      jumpKey: j.key,
    });
  }
  flows.sort((a, b) => a.date.localeCompare(b.date));
  return {
    valuations,
    flows,
    depositMinor: flows.filter((f) => f.type === "invest").reduce((s, f) => s + f.amountMinor, 0),
    withdrawalMinor: flows
      .filter((f) => f.type === "redeem")
      .reduce((s, f) => s + f.amountMinor, 0),
  };
}

/** Replay sequence of an imported event: its recorded time (flows 1 ms before their anchor). */
export function seqOf(date: string, recordedAt: string | null, offsetMs = 0): number {
  return Date.parse(recordedAt ?? `${date}T00:00:00Z`) + offsetMs;
}

/** Holding replay events of a plan (merged with existing events by the caller). */
export function planEvents(plan: ImportPlan): HoldingEvent[] {
  return [
    ...plan.valuations.map((v, i): HoldingEvent => ({
      kind: "valuation",
      id: `import-v-${i}`,
      date: v.date,
      seq: seqOf(v.date, v.recordedAt),
      valueMinor: v.valueMinor,
      units: v.units,
      priceMinorE4: v.priceMinorE4,
    })),
    ...plan.flows.map((f, i): HoldingEvent => ({
      kind: "txn",
      id: `import-f-${i}`,
      type: f.type,
      date: f.date,
      seq: seqOf(f.date, f.beforeRecordedAt, f.beforeRecordedAt ? -1 : 0),
      amountMinor: f.amountMinor,
      feeMinor: 0,
      taxMinor: 0,
    })),
  ];
}

/** Live summary: invested, current value, unrealised gain and XIRR after the import. */
export function simulateImport(input: {
  existing: readonly HoldingEvent[];
  plan: ImportPlan;
  trackUnits: boolean;
  todayKey: string;
}): {
  investedMinor: number;
  currentValueMinor: number;
  unrealisedMinor: number;
  xirrBp: number | null;
} {
  const events = [...input.existing, ...planEvents(input.plan)];
  const { state } = replayHolding(events, { trackUnits: input.trackUnits });
  return {
    investedMinor: state.investedMinor,
    currentValueMinor: state.currentValueMinor,
    unrealisedMinor: state.currentValueMinor - state.investedMinor,
    xirrBp: xirrBp(
      holdingCashFlows(events, { date: input.todayKey, valueMinor: state.currentValueMinor }),
    ),
  };
}

/** Big changes (rule 8): consecutive day-ends changing by ≥ thresholdBp (listed, not blocking). */
export function bigChanges(days: readonly DayEnd[], thresholdBp: number): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1]!.valueMinor;
    const cur = days[i]!.valueMinor;
    if (prev > 0 && Math.abs(cur - prev) * 10_000 > thresholdBp * prev) out.add(days[i]!.date);
  }
  return out;
}
