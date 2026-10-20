// CSV read/write (Phase 11). Pure. RFC 4180: quoted fields may hold the delimiter, quotes ("") and
// line breaks. Exported cells are guarded against spreadsheet formula injection.

export type Delimiter = "," | ";" | "\t";

/** The most frequent of `,` `;` and tab on the first line (outside quotes); `,` on a tie. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as Delimiter] += 1;
  }
  return (Object.keys(counts) as Delimiter[]).reduce(
    (best, d) => (counts[d] > counts[best] ? d : best),
    ",",
  );
}

/** Parses CSV text into rows of trimmed cells. Blank lines are dropped. A BOM is ignored. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Quotes when needed; text starting with = + - @ (or tab/CR) gets a leading ' unless it is a plain number. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV with a header row and CRLF line ends (Excel-friendly). */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Minor units → plain decimal text for CSV ("-1234.50"); never locale-formatted. */
export function minorToCsv(amountMinor: number, digits = 2): string {
  const neg = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  if (digits === 0) return `${neg ? "-" : ""}${abs}`;
  const unit = 10 ** digits;
  return `${neg ? "-" : ""}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`;
}

/** Basis points → percent text for CSV ("12.34"). */
export function bpToCsv(bp: number | null): string {
  return bp === null ? "" : minorToCsv(bp, 2);
}
