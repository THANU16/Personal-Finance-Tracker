import "server-only";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import {
  DATE_FORMATS,
  bankRowKeys,
  guessMapping,
  normalizeBankRows,
  type BankMapping,
  type BankRowError,
} from "@/domain/bank-import";
import { matchCategory } from "@/domain/category-rules";
import { parseCsv } from "@/domain/csv";
import { businessDateToUtc } from "@/domain/dates";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { loadRules } from "@/modules/categories/rules-service";
import { getSystemCategoryId } from "@/modules/categories/service";
import { SYSTEM_CATEGORY } from "@/modules/categories/seed";
import { ImportBatchModel, type ImportBatchDoc } from "@/modules/imports/model";
import { TransactionModel } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { postImportBatch, voidImportBatch, type ImportEntry } from "@/server/ledger/import";

// Bank statement CSV import (Phase 11, docs/03 importBatches): analyse → map columns → preview
// (rules, duplicates) → commit in ONE DB transaction → undo. The server re-parses the file on every
// step; the browser only sends the mapping and per-line choices. Rows are income (money in) or
// expense (money out); dedupe by importHash (re-importing the same file adds 0 rows).

export const MAX_BANK_CSV_CHARS = 900_000;
const IMPORT_ACCOUNT_TYPES = ["bank", "cash", "wallet", "broker_cash", "credit_card"] as const;
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const col = z.number().int().min(0).max(200);

const mappingSchema = z
  .object({
    hasHeader: z.boolean(),
    dateColumn: col,
    dateFormat: z.enum(DATE_FORMATS),
    descriptionColumn: col,
    counterpartyColumn: col.nullable(),
    amountMode: z.enum(["signed", "debit_credit"]),
    amountColumn: col.nullable(),
    debitColumn: col.nullable(),
    creditColumn: col.nullable(),
    negate: z.boolean(),
  })
  .strict()
  .refine(
    (m) =>
      m.amountMode === "signed"
        ? m.amountColumn !== null
        : m.debitColumn !== null && m.creditColumn !== null,
    {
      path: ["amountColumn"],
      message: "Choose the amount column(s)",
    },
  );

const fileSchema = {
  fileName: z.string().trim().min(1).max(260),
  csvText: z
    .string()
    .min(1, "The file is empty")
    .max(MAX_BANK_CSV_CHARS, "The file is larger than 900 KB"),
};
const analyzeSchema = z.object(fileSchema).strict();
const previewSchema = z
  .object({ ...fileSchema, accountId: objectId, mapping: mappingSchema })
  .strict();
const commitSchema = z
  .object({
    ...fileSchema,
    accountId: objectId,
    mapping: mappingSchema,
    /** Per line: skip it, or use this category instead of the rule's. */
    choices: z
      .array(
        z
          .object({
            line: z.number().int().min(1),
            skip: z.boolean().optional(),
            categoryId: objectId.nullish(),
          })
          .strict(),
      )
      .max(20_000)
      .default([]),
  })
  .strict();

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const headersKey = (h: readonly string[]) => h.map((x) => x.trim().toLowerCase()).join("|");

export interface BankAnalysis {
  headers: string[];
  sample: string[][];
  rows: number;
  mapping: BankMapping;
  /** From the last import of a file with the same columns. */
  accountId: string | null;
  accounts: { id: string; name: string; currency: string; type: string }[];
}

function table(text: string): string[][] {
  const t = parseCsv(text);
  if (t.length < 2) throw new AppError("VALIDATION", "The file has no rows");
  return t;
}

/** Headers, a sample and a mapping (the one used last time for the same columns, else a guess). */
export async function analyzeBankCsv(ctx: Ctx, input: unknown): Promise<BankAnalysis> {
  const data = parseInput(analyzeSchema, input);
  await connectDb();
  const t = table(data.csvText);
  const headers = t[0]!;
  const [last, accounts] = await Promise.all([
    ImportBatchModel.findOne({
      userId: uid(ctx),
      source: "bank_csv",
      "mapping.headersKey": headersKey(headers),
    })
      .sort({ createdAt: -1 })
      .lean<ImportBatchDoc>(),
    AccountModel.find({ userId: uid(ctx), archivedAt: null, type: { $in: IMPORT_ACCOUNT_TYPES } })
      .sort({ name: 1 })
      .lean<AccountDoc[]>(),
  ]);
  const saved = last?.mapping as { columns?: BankMapping; accountId?: string } | null;
  return {
    headers,
    sample: t.slice(1, 9),
    rows: t.length - 1,
    mapping: saved?.columns ?? guessMapping(headers, t.slice(1, 21)),
    accountId:
      saved?.accountId && accounts.some((a) => String(a._id) === saved.accountId)
        ? saved.accountId
        : null,
    accounts: accounts.map((a) => ({
      id: String(a._id),
      name: a.name,
      currency: a.currency,
      type: a.type,
    })),
  };
}

export interface PreviewRow {
  line: number;
  date: string;
  amountMinor: number;
  description: string;
  counterparty: string | null;
  duplicate: boolean;
  categoryId: string | null;
  /** The rule that chose the category (null → Uncategorised). */
  ruleId: string | null;
}

export interface BankPreview {
  currency: string;
  rows: PreviewRow[];
  errors: BankRowError[];
  totals: { rows: number; duplicates: number; inMinor: number; outMinor: number };
  categories: { id: string; label: string; kind: "income" | "expense" }[];
  uncategorised: { income: string; expense: string };
}

async function loadAccount(ctx: Ctx, accountId: string): Promise<AccountDoc> {
  const a = await AccountModel.findOne({
    _id: toObjectId(accountId, "Account"),
    userId: uid(ctx),
  }).lean<AccountDoc>();
  if (!a || a.archivedAt) throw new AppError("NOT_FOUND", "Account not found");
  if (!(IMPORT_ACCOUNT_TYPES as readonly string[]).includes(a.type)) {
    throw new AppError(
      "VALIDATION",
      "Import into a bank, cash, wallet, broker cash or card account",
    );
  }
  return a;
}

const hashOf = (ctx: Ctx, key: string) =>
  createHash("sha256").update(`${ctx.userId}|bank|${key}`).digest("hex");

async function buildPreview(
  ctx: Ctx,
  data: z.infer<typeof previewSchema>,
): Promise<BankPreview & { hashes: Map<number, string> }> {
  await connectDb();
  const account = await loadAccount(ctx, data.accountId);
  const { rows, errors } = normalizeBankRows(table(data.csvText), data.mapping, account.currency);
  const keys = bankRowKeys(String(account._id), rows);
  const hashes = new Map(rows.map((r, i) => [r.line, hashOf(ctx, keys[i]!)]));
  const [existing, rules, categories, uncatIncome, uncatExpense] = await Promise.all([
    TransactionModel.find({ userId: uid(ctx), importHash: { $in: [...hashes.values()] } })
      .select({ importHash: 1 })
      .lean<{ importHash: string }[]>(),
    loadRules(ctx),
    CategoryModel.find({ userId: uid(ctx), archivedAt: null }).lean<CategoryDoc[]>(),
    getSystemCategoryId(ctx, SYSTEM_CATEGORY.uncategorised, "income").catch(() => null),
    getSystemCategoryId(ctx, SYSTEM_CATEGORY.uncategorised, "expense").catch(() => null),
  ]);
  const seen = new Set(existing.map((e) => e.importHash));
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const preview: PreviewRow[] = rows.map((r) => {
    const rule = matchCategory(rules, r);
    const fallback = r.amountMinor > 0 ? uncatIncome : uncatExpense;
    return {
      ...r,
      duplicate: seen.has(hashes.get(r.line)!),
      categoryId: rule?.categoryId ?? (fallback ? String(fallback) : null),
      ruleId: rule?.id ?? null,
    };
  });
  const fresh = preview.filter((r) => !r.duplicate);
  return {
    currency: account.currency,
    rows: preview,
    errors,
    hashes,
    totals: {
      rows: preview.length,
      duplicates: preview.length - fresh.length,
      inMinor: fresh.filter((r) => r.amountMinor > 0).reduce((s, r) => s + r.amountMinor, 0),
      outMinor: fresh.filter((r) => r.amountMinor < 0).reduce((s, r) => s - r.amountMinor, 0),
    },
    categories: categories
      .filter((c) => c.kind === "income" || c.kind === "expense")
      .map((c) => {
        const parent = c.parentId ? byId.get(String(c.parentId)) : undefined;
        return {
          id: String(c._id),
          label: parent ? `${parent.name} › ${c.name}` : c.name,
          kind: c.kind,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    uncategorised: {
      income: uncatIncome ? String(uncatIncome) : "",
      expense: uncatExpense ? String(uncatExpense) : "",
    },
  };
}

export async function previewBankImport(ctx: Ctx, input: unknown): Promise<BankPreview> {
  const { hashes: _hashes, ...preview } = await buildPreview(ctx, parseInput(previewSchema, input));
  void _hashes;
  return preview;
}

export interface BankImportResult {
  batchId: string;
  imported: number;
  duplicates: number;
  skipped: number;
}

/** Re-parses the file, applies the per-line choices and posts the new rows in one DB transaction. */
export async function commitBankImport(ctx: Ctx, input: unknown): Promise<BankImportResult> {
  const data = parseInput(commitSchema, input);
  const preview = await buildPreview(ctx, data);
  const choices = new Map(data.choices.map((c) => [c.line, c]));
  const kindOf = new Map(preview.categories.map((c) => [c.id, c.kind]));
  const toPost = preview.rows.filter((r) => !r.duplicate && !choices.get(r.line)?.skip);
  if (toPost.length === 0) throw new AppError("VALIDATION", "Nothing new to import");
  const accountId = toObjectId(data.accountId, "Account");
  const entries: ImportEntry[] = toPost.map((r) => {
    const income = r.amountMinor > 0;
    const chosen = choices.get(r.line)?.categoryId ?? r.categoryId;
    if (!chosen || kindOf.get(chosen) !== (income ? "income" : "expense")) {
      throw new AppError(
        "VALIDATION",
        `Line ${r.line}: choose ${income ? "an income" : "an expense"} category`,
      );
    }
    return {
      kind: "txn",
      type: income ? "income" : "expense",
      date: businessDateToUtc(r.date, ctx.tz),
      amountMinor: Math.abs(r.amountMinor),
      ...(income ? { toAccountId: accountId } : { fromAccountId: accountId }),
      categoryId: new Types.ObjectId(chosen),
      description: r.description.slice(0, 200),
      notes: r.counterparty ? `Counterparty: ${r.counterparty}`.slice(0, 500) : null,
      importHash: preview.hashes.get(r.line)!,
    };
  });
  const dates = toPost.map((r) => r.date).sort();
  return withTransaction(async (session) => {
    const [batch] = await ImportBatchModel.create(
      [
        {
          userId: uid(ctx),
          kind: "transactions",
          source: "bank_csv",
          status: "imported",
          files: [
            {
              name: data.fileName,
              sheet: "csv",
              rows: preview.rows.length + preview.errors.length,
              from: dates[0]!,
              to: dates.at(-1)!,
            },
          ],
          mapping: {
            accountId: data.accountId,
            columns: data.mapping,
            headersKey: headersKey(parseCsv(data.csvText)[0] ?? []),
          },
          warnings: preview.errors.map((e) => `Line ${e.line}: ${e.message}`).slice(0, 200),
          summary: {
            transactions: entries.length,
            rows: preview.rows.length,
            duplicates: preview.totals.duplicates,
            skipped: preview.rows.length - preview.totals.duplicates - entries.length,
            errors: preview.errors.length,
          },
          importedAt: new Date(),
        },
      ],
      { session },
    );
    await postImportBatch(ctx, batch!._id, entries, session);
    return {
      batchId: String(batch!._id),
      imported: entries.length,
      duplicates: preview.totals.duplicates,
      skipped: preview.rows.length - preview.totals.duplicates - entries.length,
    };
  });
}

/** Voids the batch's transactions (hashes suffixed so the rows can be imported again). */
export async function undoBankImport(ctx: Ctx, batchId: string): Promise<{ voided: number }> {
  return withTransaction(async (session) => {
    const batch = await ImportBatchModel.findOne({
      _id: toObjectId(batchId, "Import"),
      userId: uid(ctx),
      source: "bank_csv",
    })
      .session(session)
      .lean<ImportBatchDoc>();
    if (!batch) throw new AppError("NOT_FOUND", "Import not found");
    if (batch.status !== "imported")
      throw new AppError("CONFLICT", "This import was already undone");
    const { voided } = await voidImportBatch(ctx, batch._id, session);
    await ImportBatchModel.updateOne(
      { _id: batch._id, userId: uid(ctx) },
      { $set: { status: "reverted", revertedAt: new Date() } },
      { session },
    );
    return { voided };
  });
}

export interface BankImportItem {
  id: string;
  status: ImportBatchDoc["status"];
  fileName: string;
  accountName: string;
  from: string | null;
  to: string | null;
  transactions: number;
  duplicates: number;
  createdAt: string;
}

/** Recent bank statement imports (newest first) for the import page. */
export async function listBankImports(ctx: Ctx): Promise<BankImportItem[]> {
  await connectDb();
  const [batches, accounts] = await Promise.all([
    ImportBatchModel.find({ userId: uid(ctx), source: "bank_csv" })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean<ImportBatchDoc[]>(),
    AccountModel.find({ userId: uid(ctx) })
      .select({ name: 1 })
      .lean<Pick<AccountDoc, "_id" | "name">[]>(),
  ]);
  const names = new Map(accounts.map((a) => [String(a._id), a.name]));
  return batches.map((b) => {
    const m = (b.mapping ?? {}) as { accountId?: string };
    const s = (b.summary ?? {}) as { transactions?: number; duplicates?: number };
    return {
      id: String(b._id),
      status: b.status,
      fileName: b.files[0]?.name ?? "file.csv",
      accountName: (m.accountId && names.get(m.accountId)) || "Account",
      from: b.files[0]?.from ?? null,
      to: b.files[0]?.to ?? null,
      transactions: s.transactions ?? 0,
      duplicates: s.duplicates ?? 0,
      createdAt: b.createdAt.toISOString(),
    };
  });
}
