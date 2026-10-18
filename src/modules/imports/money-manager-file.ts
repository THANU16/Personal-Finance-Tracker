import "server-only";
import readXlsxFile from "read-excel-file/node";
import { MM_COLUMNS, nameKey, type RawRow } from "@/domain/money-manager";
import { AppError } from "@/server/errors";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ParsedFile {
  name: string;
  sheets: { sheet: string; rows: RawRow[] }[];
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Header row matches the Money Manager export (first 10 columns, case/space-insensitive). */
function isMoneyManagerHeader(row: readonly unknown[]): boolean {
  return MM_COLUMNS.every((col, i) => nameKey(cellText(row[i])) === nameKey(col));
}

/**
 * Reads every sheet of a Money Manager .xlsx export. Numbers stay as their decimal strings
 * (`parseNumber`), so amounts are never parsed as floats; Period cells come back as Dates whose UTC
 * fields are the wall clock Money Manager recorded. Sheets without the expected header are skipped;
 * a file with none is rejected. `fileIndex` numbers each sheet in upload order for merging.
 */
export async function readMoneyManagerFile(
  name: string,
  buffer: Buffer,
  firstIndex: number,
): Promise<ParsedFile> {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new AppError("VALIDATION", `${name} is larger than 10 MB`);
  }
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(buffer, { parseNumber: (s: string) => s })) as {
      sheet: string;
      data: unknown[][];
    }[];
  } catch {
    throw new AppError("VALIDATION", `${name} is not a readable Excel (.xlsx) file`);
  }
  const out: ParsedFile = { name, sheets: [] };
  let index = firstIndex;
  for (const s of sheets) {
    const [header, ...data] = s.data;
    if (!header || !isMoneyManagerHeader(header)) continue;
    const rows: RawRow[] = data
      .filter((r) => r.some((c) => c !== null && cellText(c) !== ""))
      .map((r, i) => ({
        file: index,
        rowIndex: i + 1,
        period: r[0] instanceof Date ? r[0] : cellText(r[0]) || null,
        account: cellText(r[1]),
        category: cellText(r[2]),
        subcategory: cellText(r[3]),
        note: cellText(r[4]),
        type: cellText(r[6]),
        description: cellText(r[7]),
        amountText: cellText(r[8] ?? r[5]),
        currency: cellText(r[9]),
      }));
    out.sheets.push({ sheet: s.sheet, rows });
    index += 1;
  }
  if (out.sheets.length === 0) {
    throw new AppError(
      "VALIDATION",
      `${name} does not look like a Money Manager export (expected columns: ${MM_COLUMNS.join(", ")})`,
    );
  }
  return out;
}
