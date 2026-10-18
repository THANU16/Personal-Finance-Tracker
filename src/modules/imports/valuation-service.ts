import "server-only";
import { createHash } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import { z } from "zod";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import type { HoldingEvent } from "@/domain/holdings";
import {
  DEFAULT_JUMP_THRESHOLD_BP,
  assetNameFromFileName,
  buildImportPlan,
  dayEnds,
  detectJumps,
  matchHolding,
  orderRows,
  parseValuationCsv,
  seqOf,
  validateRows,
  type CsvRow,
  type ExistingFlow,
} from "@/domain/valuation-import";
import { dateKey } from "@/modules/accounts/schemas";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import {
  HoldingModel,
  ValuationModel,
  INSTRUMENT_TYPES,
  LIQUIDITY,
  type HoldingDoc,
} from "@/modules/holdings/model";
import { ImportBatchModel, type ImportBatchDoc } from "@/modules/imports/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { loadHoldingEvents } from "@/server/ledger/holding-events";
import { postImportBatch, voidImportBatch, type ImportEntry } from "@/server/ledger/import";

// docs/04 §23 — valuation history CSV import: analyse (no writes) → preview in the browser (pure
// domain functions recalculate live) → commit in ONE DB transaction → undo.

// Server actions accept 1 MB bodies by default; valuation exports are a few KB.
export const MAX_CSV_CHARS = 900_000;
export const EXTERNAL_FUNDING_NAME = "Historical funding (external)";
const FUNDING_TYPES = ["bank", "cash", "wallet", "broker_cash"] as const;

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const csvText = z
  .string()
  .min(1, "The file is empty")
  .max(MAX_CSV_CHARS, "The file is larger than 900 KB");

export const analyzeSchema = z
  .object({ fileName: z.string().trim().min(1).max(260), csvText, holdingId: objectId.nullish() })
  .strict();

export const commitSchema = z
  .object({
    fileName: z.string().trim().min(1).max(260),
    csvText,
    holding: z.union([
      z.object({ existingId: objectId }).strict(),
      z
        .object({
          create: z
            .object({
              name: z.string().trim().min(1, "Enter a name").max(80),
              assetClassId: objectId,
              instrumentType: z
                .enum(INSTRUMENT_TYPES)
                .refine(
                  (t) => t !== "fd",
                  "A fixed deposit with terms cannot take imported values",
                ),
              liquidity: z.enum(LIQUIDITY).default("medium"),
            })
            .strict(),
        })
        .strict(),
    ]),
    funding: z
      .union([
        z.object({ existingId: objectId }).strict(),
        z.object({ createExternal: z.literal(true) }).strict(),
      ])
      .nullable(),
    firstAsInvestment: z.boolean(),
    thresholdBp: z.number().int().min(100).max(10_000).default(DEFAULT_JUMP_THRESHOLD_BP),
    choices: z
      .record(
        z.string(),
        z
          .object({
            action: z.enum(["deposit", "withdrawal", "market"]),
            amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
            date: dateKey,
          })
          .strict(),
      )
      .default({}),
  })
  .strict();
export type CommitValuationImportInput = z.input<typeof commitSchema>;

export interface ValuationImportAnalysis {
  fileName: string;
  assetName: string;
  todayKey: string;
  baseCurrency: string;
  fileError: string | null;
  rows: CsvRow[];
  /** Lines already imported for the chosen holding. */
  duplicateLines: number[];
  holding: {
    id: string;
    name: string;
    currency: string;
    trackUnits: boolean;
    hasInitialTransactions: boolean;
    existingEvents: HoldingEvent[];
    existingFlows: ExistingFlow[];
  } | null;
  suggestedHoldingId: string | null;
  options: {
    holdings: { id: string; name: string; currency: string; isFd: boolean }[];
    accounts: { id: string; name: string; currency: string; type: string; openingDate: string }[];
    assetClasses: { id: string; name: string }[];
  };
}

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);

export function valuationHash(
  userId: string,
  holdingId: string,
  r: Pick<CsvRow, "date" | "valueMinor" | "recordedAt">,
): string {
  return createHash("sha256")
    .update(`${userId}|${holdingId}|${r.date}|${r.valueMinor}|${r.recordedAt ?? ""}`)
    .digest("hex");
}

async function holdingContext(ctx: Ctx, h: HoldingDoc, session: ClientSession | null) {
  const { events, txns } = await loadHoldingEvents(uid(ctx), h._id, ctx.tz, session);
  const flows: ExistingFlow[] = txns
    .filter((t) => t.type === "invest" || t.type === "redeem")
    .map((t) => ({
      type: t.type as "invest" | "redeem",
      date: utcToBusinessDate(t.date, ctx.tz),
      amountMinor: t.amountMinor,
    }));
  return {
    events,
    flows,
    hasInitial: txns.some((t) => t.type === "invest" || t.type === "opening_balance"),
  };
}

async function duplicatesOf(
  ctx: Ctx,
  holdingId: string,
  rows: readonly CsvRow[],
  session: ClientSession | null,
): Promise<Set<number>> {
  const hashes = new Map(
    rows
      .filter((r) => !r.errors.length)
      .map((r) => [valuationHash(ctx.userId, holdingId, r), r.line]),
  );
  if (!hashes.size) return new Set();
  const found = await ValuationModel.find({
    userId: uid(ctx),
    importHash: { $in: [...hashes.keys()] },
  })
    .select({ importHash: 1 })
    .session(session)
    .lean<{ importHash: string }[]>();
  return new Set(found.map((f) => hashes.get(f.importHash)!));
}

/** Analyse one CSV (nothing is written): parsed rows, errors, duplicates and the holding's context. */
export async function analyzeValuationFile(
  ctx: Ctx,
  input: unknown,
): Promise<ValuationImportAnalysis> {
  const data = parseInput(analyzeSchema, input);
  await connectDb();
  const userId = uid(ctx);
  const [holdings, accounts, classes] = await Promise.all([
    HoldingModel.find({ userId, status: "active" }).sort({ name: 1 }).lean<HoldingDoc[]>(),
    AccountModel.find({ userId, archivedAt: null, type: { $in: FUNDING_TYPES } })
      .sort({ name: 1 })
      .lean<AccountDoc[]>(),
    AssetClassModel.find({ userId, archivedAt: null })
      .sort({ sortOrder: 1, name: 1 })
      .lean<AssetClassDoc[]>(),
  ]);
  const assetName = assetNameFromFileName(data.fileName);
  const selectable = holdings.filter((h) => !h.fd);
  const suggested = matchHolding(
    assetName,
    selectable.map((h) => ({ id: String(h._id), name: h.name })),
  );
  const chosen = data.holdingId
    ? holdings.find((h) => String(h._id) === data.holdingId)
    : undefined;
  if (data.holdingId && !chosen) throw new AppError("NOT_FOUND", "Holding not found");
  const parsed = parseValuationCsv(data.csvText, chosen?.currency ?? ctx.baseCurrency);
  const today = todayOf(ctx);
  const firstCurrency = parsed.rows.find((r) => !r.errors.length)?.currency ?? ctx.baseCurrency;
  const rows = validateRows(parsed.rows, {
    todayKey: today,
    currency: chosen?.currency ?? firstCurrency,
  });
  let holding: ValuationImportAnalysis["holding"] = null;
  let duplicateLines: number[] = [];
  if (chosen) {
    const c = await holdingContext(ctx, chosen, null);
    holding = {
      id: String(chosen._id),
      name: chosen.name,
      currency: chosen.currency,
      trackUnits: chosen.trackUnits,
      hasInitialTransactions: c.hasInitial,
      existingEvents: c.events,
      existingFlows: c.flows,
    };
    duplicateLines = [...(await duplicatesOf(ctx, String(chosen._id), rows, null))];
  }
  return {
    fileName: data.fileName,
    assetName,
    todayKey: today,
    baseCurrency: ctx.baseCurrency,
    fileError: parsed.fileError,
    rows,
    duplicateLines,
    holding,
    suggestedHoldingId: suggested?.id ?? null,
    options: {
      holdings: holdings.map((h) => ({
        id: String(h._id),
        name: h.name,
        currency: h.currency,
        isFd: Boolean(h.fd),
      })),
      accounts: accounts.map((a) => ({
        id: String(a._id),
        name: a.name,
        currency: a.currency,
        type: a.type,
        openingDate: utcToBusinessDate(a.openingDate, ctx.tz),
      })),
      assetClasses: classes.map((c) => ({ id: String(c._id), name: c.name })),
    },
  };
}

export interface ValuationImportResult {
  batchId: string;
  holdingId: string;
  valuations: number;
  duplicates: number;
  errors: number;
  deposits: number;
  withdrawals: number;
  months: string[];
}

/**
 * Commit (docs/04 §23 rule 10): the server re-parses the file and rebuilds the plan from the user's
 * jump choices, then in ONE DB transaction creates the holding/funding account if asked, the batch,
 * the valuations and the invest/redeem transactions (ledger bulk path, source import), and
 * recomputes the holding and the account.
 */
export async function commitValuationImport(
  ctx: Ctx,
  input: unknown,
): Promise<ValuationImportResult> {
  const data = parseInput(commitSchema, input);
  const today = todayOf(ctx);
  return withTransaction(async (session) => {
    const userId = uid(ctx);

    // Holding: existing (active, not an FD with terms) or created here.
    let holding: HoldingDoc;
    if ("existingId" in data.holding) {
      const h = await HoldingModel.findOne({
        _id: toObjectId(data.holding.existingId, "Holding"),
        userId,
      })
        .session(session)
        .lean<HoldingDoc>();
      if (!h) throw new AppError("NOT_FOUND", "Holding not found");
      if (h.status !== "active") throw new AppError("VALIDATION", `"${h.name}" is closed`);
      if (h.fd)
        throw new AppError(
          "VALIDATION",
          `"${h.name}" has deposit terms; its value is calculated, not imported`,
        );
      holding = h;
    } else {
      const spec = data.holding.create;
      const cls = await AssetClassModel.findOne({
        _id: toObjectId(spec.assetClassId, "Asset class"),
        userId,
        archivedAt: null,
      })
        .session(session)
        .lean<AssetClassDoc>();
      if (!cls)
        throw new AppError("VALIDATION", "Choose an active asset class", {
          assetClassId: ["Asset class"],
        });
      const parsedCurrency =
        parseValuationCsv(data.csvText, ctx.baseCurrency).rows.find((r) => !r.errors.length)
          ?.currency ?? ctx.baseCurrency;
      const [doc] = await HoldingModel.create(
        [
          {
            userId,
            name: spec.name,
            assetClassId: cls._id,
            instrumentType: spec.instrumentType,
            currency: parsedCurrency,
            liquidity: spec.liquidity,
            trackUnits: false,
            notes: "Created by a valuation import",
          },
        ],
        { session },
      );
      holding = doc!.toObject() as HoldingDoc;
    }
    const holdingId = String(holding._id);

    // Rows: parse + validate again on the server; skip errors and duplicates (never silently).
    const parsed = parseValuationCsv(data.csvText, holding.currency);
    if (parsed.fileError) throw new AppError("VALIDATION", parsed.fileError);
    const rows = validateRows(parsed.rows, { todayKey: today, currency: holding.currency });
    const valid = rows.filter((r) => !r.errors.length);
    const dupLines = await duplicatesOf(ctx, holdingId, valid, session);
    const fresh = valid.filter((r) => !dupLines.has(r.line));
    if (!fresh.length)
      throw new AppError(
        "VALIDATION",
        "Nothing new to import: every row is a duplicate or has an error",
      );

    const context = await holdingContext(ctx, holding, session);
    const days = dayEnds(orderRows(valid));
    const jumps = detectJumps(days, {
      thresholdBp: data.thresholdBp,
      currency: holding.currency,
      existingFlows: context.flows,
      newDates: new Set(fresh.map((r) => r.date)),
    });
    for (const [key, c] of Object.entries(data.choices)) {
      if (!jumps.some((j) => j.key === key)) continue;
      if (c.action !== "market" && c.amountMinor <= 0)
        throw new AppError("VALIDATION", `Enter an amount for the ${key.replace(">", " → ")} jump`);
      if (c.date > today)
        throw new AppError("VALIDATION", "A deposit or withdrawal cannot be in the future");
    }
    const plan = buildImportPlan({
      rows: fresh,
      jumps,
      choices: data.choices,
      firstAsInvestment: data.firstAsInvestment && !context.hasInitial,
      trackUnits: holding.trackUnits,
    });

    // Funding account (only needed when there are flows).
    let funding: AccountDoc | null = null;
    if (plan.flows.length) {
      if (!data.funding)
        throw new AppError("VALIDATION", "Choose the account deposits come from", {
          funding: ["Required"],
        });
      const firstFlow = plan.flows[0]!.date;
      if ("existingId" in data.funding) {
        funding = await AccountModel.findOne({
          _id: toObjectId(data.funding.existingId, "Account"),
          userId,
        })
          .session(session)
          .lean<AccountDoc>();
        if (
          !funding ||
          funding.archivedAt ||
          !(FUNDING_TYPES as readonly string[]).includes(funding.type)
        ) {
          throw new AppError(
            "VALIDATION",
            "Choose an active bank, cash, wallet or broker cash account",
            { funding: ["Account"] },
          );
        }
        if (funding.currency !== holding.currency)
          throw new AppError(
            "VALIDATION",
            `"${funding.name}" is in ${funding.currency}; the holding is in ${holding.currency}`,
          );
        const opened = utcToBusinessDate(funding.openingDate, ctx.tz);
        if (opened > firstFlow) {
          throw new AppError(
            "VALIDATION",
            `"${funding.name}" opens on ${opened}, after the first deposit (${firstFlow}): move its opening date or use the external funding account`,
          );
        }
      } else {
        const existing = await AccountModel.findOne({
          userId,
          name: EXTERNAL_FUNDING_NAME,
          currency: holding.currency,
          archivedAt: null,
        })
          .session(session)
          .lean<AccountDoc>();
        if (existing && utcToBusinessDate(existing.openingDate, ctx.tz) > firstFlow) {
          await AccountModel.updateOne(
            { _id: existing._id, userId },
            { $set: { openingDate: businessDateToUtc(firstFlow, ctx.tz) } },
            { session },
          );
        }
        funding =
          existing ??
          ((
            await AccountModel.create(
              [
                {
                  userId,
                  name: EXTERNAL_FUNDING_NAME,
                  type: "cash",
                  currency: holding.currency,
                  openingBalanceMinor: 0,
                  openingDate: businessDateToUtc(firstFlow, ctx.tz),
                  balanceMinor: 0,
                  includeInNetWorth: false,
                  notes:
                    "Money that funded or received imported investment history (outside your real accounts).",
                },
              ],
              { session },
            )
          )[0]!.toObject() as AccountDoc);
      }
    }

    const files = [
      {
        name: data.fileName,
        sheet: "csv",
        rows: rows.length,
        from: days[0]?.date ?? null,
        to: days.at(-1)?.date ?? null,
      },
    ];
    const summary = {
      rows: rows.length,
      imported: plan.valuations.length,
      duplicates: dupLines.size,
      errors: rows.length - valid.length,
      deposits: plan.flows.filter((f) => f.type === "invest").length,
      withdrawals: plan.flows.filter((f) => f.type === "redeem").length,
      depositMinor: plan.depositMinor,
      withdrawalMinor: plan.withdrawalMinor,
    };
    const [batch] = await ImportBatchModel.create(
      [
        {
          userId,
          kind: "valuations",
          source: "valuation_csv",
          status: "imported",
          files,
          holdingId: holding._id,
          fundingAccountId: funding?._id ?? null,
          mapping: {
            thresholdBp: data.thresholdBp,
            firstAsInvestment: data.firstAsInvestment,
            choices: data.choices,
          },
          summary,
          importedAt: new Date(),
        },
      ],
      { session },
    );
    const batchId = batch!._id;

    const entries: ImportEntry[] = [
      ...plan.valuations.map((v): ImportEntry => ({
        kind: "valuation",
        holdingId: holding._id,
        date: businessDateToUtc(v.date, ctx.tz),
        valueMinor: v.valueMinor,
        units: v.units,
        priceMinorE4: v.priceMinorE4,
        note: v.note || "Imported value",
        recordedAt: v.recordedAt ? new Date(v.recordedAt) : null,
        importHash: valuationHash(ctx.userId, holdingId, v),
      })),
      ...plan.flows.map((f, i): ImportEntry => ({
        kind: "txn",
        type: f.type,
        date: businessDateToUtc(f.date, ctx.tz),
        amountMinor: f.amountMinor,
        feeMinor: 0,
        ...(f.type === "invest" ? { fromAccountId: funding!._id } : { toAccountId: funding!._id }),
        holdingId: holding._id,
        description:
          f.reason === "initial"
            ? "Initial investment (imported history)"
            : f.type === "invest"
              ? "Deposit (imported history)"
              : "Withdrawal (imported history)",
        importHash: createHash("sha256")
          .update(
            `vflow|${ctx.userId}|${String(batchId)}|${i}|${f.type}|${f.date}|${f.amountMinor}`,
          )
          .digest("hex"),
        // Just before the first valuation of its date (docs/04 §23 rule 9).
        createdAt: new Date(seqOf(f.date, f.beforeRecordedAt, f.beforeRecordedAt ? -1 : 0)),
      })),
    ];
    await postImportBatch(ctx, batchId, entries, session);
    await writeAudit(
      {
        userId: ctx.userId,
        action: "import_valuations",
        entity: "importBatch",
        entityId: batchId,
        after: summary,
      },
      session,
    );
    return {
      batchId: String(batchId),
      holdingId,
      valuations: summary.imported,
      duplicates: summary.duplicates,
      errors: summary.errors,
      deposits: summary.deposits,
      withdrawals: summary.withdrawals,
      months: [...new Set(plan.valuations.map((v) => v.date.slice(0, 7)))].sort(),
    };
  });
}

/** Undo (rule 11): void the batch's transactions, delete its valuations, recompute, mark reverted. */
export async function undoValuationImport(
  ctx: Ctx,
  batchId: string,
): Promise<{ voided: number; valuationsRemoved: number }> {
  return withTransaction(async (session) => {
    const userId = uid(ctx);
    const batch = await ImportBatchModel.findOne({
      _id: toObjectId(batchId, "Import"),
      userId,
      kind: "valuations",
    })
      .session(session)
      .lean<ImportBatchDoc>();
    if (!batch) throw new AppError("NOT_FOUND", "Import not found");
    if (batch.status !== "imported")
      throw new AppError("CONFLICT", "This import was already undone");
    const r = await voidImportBatch(ctx, batch._id, session);
    await ImportBatchModel.updateOne(
      { _id: batch._id, userId },
      { $set: { status: "reverted", revertedAt: new Date() } },
      { session },
    );
    return r;
  });
}

export interface ImportHistoryItem {
  id: string;
  kind: "transactions" | "valuations";
  source: string;
  status: ImportBatchDoc["status"];
  files: string[];
  holding: { id: string; name: string } | null;
  createdAt: string;
  summary: string;
}

/** All imports (Money Manager and valuation CSV) for Settings → Data. */
export async function listImportHistory(ctx: Ctx): Promise<ImportHistoryItem[]> {
  await connectDb();
  const userId = uid(ctx);
  const batches = await ImportBatchModel.find({ userId, status: { $ne: "draft" } })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<ImportBatchDoc[]>();
  const holdingIds = batches.map((b) => b.holdingId).filter((v): v is Types.ObjectId => Boolean(v));
  const holdings = new Map(
    (
      await HoldingModel.find({ userId, _id: { $in: holdingIds } })
        .select({ name: 1 })
        .lean<Pick<HoldingDoc, "_id" | "name">[]>()
    ).map((h) => [String(h._id), h.name]),
  );
  return batches.map((b) => {
    const s = (b.summary ?? {}) as {
      imported?: number;
      duplicates?: number;
      transactions?: number;
      deposits?: number;
      withdrawals?: number;
    };
    return {
      id: String(b._id),
      kind: b.kind ?? "transactions",
      source: b.source,
      status: b.status,
      files: [...new Set(b.files.map((f) => f.name))],
      holding: b.holdingId
        ? { id: String(b.holdingId), name: holdings.get(String(b.holdingId)) ?? "Holding" }
        : null,
      createdAt: b.createdAt.toISOString(),
      summary:
        b.kind === "valuations"
          ? `${s.imported ?? 0} values, ${s.deposits ?? 0} deposits, ${s.withdrawals ?? 0} withdrawals${s.duplicates ? `, ${s.duplicates} duplicates skipped` : ""}`
          : `${s.transactions ?? 0} transactions`,
    };
  });
}
