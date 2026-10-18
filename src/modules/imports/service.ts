import "server-only";
import { Types, type ClientSession } from "mongoose";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import {
  MM_SOURCE,
  UNCATEGORISED,
  buildPostingPlan,
  categoryTree,
  classifyRows,
  isDifferenceRow,
  mergeFiles,
  mergeHints,
  mmBalancesByTarget,
  nameKey,
  normaliseRows,
  resolveAccount,
  suggestAccount,
  summariseAccounts,
  type CategoryMapping,
  type Classified,
  type ImportMapping,
  type MmRow,
  type PlanOp,
  type PostingPlan,
} from "@/domain/money-manager";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { AssetClassModel, type AssetClassDoc } from "@/modules/asset-classes/model";
import { CategoryModel, type CategoryDoc, type CategoryKind } from "@/modules/categories/model";
import { getSystemCategoryId } from "@/modules/categories/service";
import { SYSTEM_CATEGORY } from "@/modules/categories/seed";
import { HoldingModel, ValuationModel, type HoldingDoc } from "@/modules/holdings/model";
import {
  ImportBatchModel,
  ImportMappingModel,
  ImportRowModel,
  type ImportBatchDoc,
  type ImportMappingDoc,
  type ImportRowDoc,
} from "@/modules/imports/model";
import { readMoneyManagerFile } from "@/modules/imports/money-manager-file";
import {
  batchIdSchema,
  commitSchema,
  saveMappingSchema,
  undoSchema,
  wizardStateSchema,
  type AccountChoice,
  type CategoryChoice,
  type ImportResult,
  type PreviewData,
  type PreviewLine,
  type WizardData,
  type WizardRowRef,
  type WizardState,
} from "@/modules/imports/schemas";
import { TransactionModel } from "@/modules/transactions/model";
import { parseInput } from "@/server/action-result";
import { writeAudit } from "@/server/audit/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { postImportBatch, voidImportBatch, type ImportEntry } from "@/server/ledger/import";

// docs/07 — Money Manager import: upload → draft (staging rows + suggested mapping) → wizard →
// preview (dry run) → commit (ONE DB transaction) → undo.

const NEW = "new:";
const newAccountRef = (key: string) => `${NEW}${key}`;
const newCategoryRef = (kind: CategoryKind, key: string) => `${NEW}${kind}:${key}`;

async function loadBatch(
  ctx: Ctx,
  batchId: string,
  session: ClientSession | null = null,
): Promise<ImportBatchDoc> {
  const batch = await ImportBatchModel.findOne({
    _id: toObjectId(batchId, "Import"),
    userId: toObjectId(ctx.userId, "User"),
  })
    .session(session)
    .lean<ImportBatchDoc>();
  if (!batch) throw new AppError("NOT_FOUND", "Import not found");
  return batch;
}

/** Rows of the batch in merged chronological order; `onlyNew` drops rows already imported before. */
async function loadRows(
  ctx: Ctx,
  batchId: Types.ObjectId,
  onlyNew: boolean,
  session: ClientSession | null = null,
): Promise<MmRow[]> {
  const docs = await ImportRowModel.find({
    userId: toObjectId(ctx.userId, "User"),
    batchId,
    ...(onlyNew ? { alreadyImported: false } : {}),
  })
    .sort({ seq: 1 })
    .session(session)
    .lean<ImportRowDoc[]>();
  return docs.map((d) => d.normalized as MmRow);
}

interface Existing {
  accounts: AccountDoc[];
  holdings: HoldingDoc[];
  categories: CategoryDoc[];
  assetClasses: AssetClassDoc[];
}

async function loadExisting(ctx: Ctx, session: ClientSession | null = null): Promise<Existing> {
  const userId = toObjectId(ctx.userId, "User");
  const [accounts, holdings, categories, assetClasses] = await Promise.all([
    AccountModel.find({ userId, archivedAt: null })
      .sort({ name: 1 })
      .session(session)
      .lean<AccountDoc[]>(),
    HoldingModel.find({ userId, status: "active" })
      .sort({ name: 1 })
      .session(session)
      .lean<HoldingDoc[]>(),
    CategoryModel.find({ userId, archivedAt: null })
      .sort({ name: 1 })
      .session(session)
      .lean<CategoryDoc[]>(),
    AssetClassModel.find({ userId, archivedAt: null })
      .sort({ sortOrder: 1, name: 1 })
      .session(session)
      .lean<AssetClassDoc[]>(),
  ]);
  return { accounts, holdings, categories, assetClasses };
}

// ------------------------------------------------------------------------------------ draft

/** Uploaded files → normalised, merged staging rows and a suggested mapping (nothing posted). */
export async function createMoneyManagerDraft(
  ctx: Ctx,
  files: readonly { name: string; buffer: Buffer }[],
): Promise<{ batchId: string }> {
  if (!files.length) throw new AppError("VALIDATION", "Choose at least one .xlsx file");
  await connectDb();
  const todayKey = utcToBusinessDate(new Date(), ctx.tz);
  const perSheet: MmRow[][] = [];
  const fileInfo: ImportBatchDoc["files"] = [];
  let index = 0;
  for (const f of files) {
    const parsed = await readMoneyManagerFile(f.name, f.buffer, index);
    for (const s of parsed.sheets) {
      const rows = normaliseRows(s.rows, { todayKey, baseCurrency: ctx.baseCurrency });
      const dates = rows
        .map((r) => r.date)
        .filter(Boolean)
        .sort();
      perSheet.push(rows);
      fileInfo.push({
        name: f.name,
        sheet: s.sheet,
        rows: rows.length,
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
      });
      index += 1;
    }
  }
  const { rows, duplicates } = mergeFiles(perSheet);
  if (!rows.length) throw new AppError("VALIDATION", "The file has no rows to import");

  const userId = toObjectId(ctx.userId, "User");
  const importedBatches = await ImportBatchModel.find({
    userId,
    source: MM_SOURCE,
    status: "imported",
  })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  const imported = new Set(
    (
      await ImportRowModel.find({
        userId,
        batchId: { $in: importedBatches.map((b) => b._id) },
        hash: { $in: rows.map((r) => r.hash) },
      })
        .select({ hash: 1 })
        .lean<{ hash: string }[]>()
    ).map((r) => r.hash),
  );
  const fresh = rows.filter((r) => !imported.has(r.hash));
  const kinds = classifyRows(rows).kindOf;

  const warnings: string[] = [];
  if (duplicates.length) {
    warnings.push(
      `${duplicates.length} row${duplicates.length === 1 ? "" : "s"} appear in more than one file and were counted once`,
    );
  }
  if (imported.size) {
    warnings.push(`${rows.length - fresh.length} rows were imported before and will be skipped`);
  }

  const existing = await loadExisting(ctx);
  const saved = await ImportMappingModel.find({ userId, source: MM_SOURCE }).lean<
    ImportMappingDoc[]
  >();
  const state = defaultState(ctx, fresh, existing, saved);

  return withTransaction(async (session) => {
    const [batch] = await ImportBatchModel.create(
      [
        {
          userId,
          source: MM_SOURCE,
          status: "draft",
          files: fileInfo,
          mapping: state,
          warnings,
          summary: null,
        },
      ],
      { session },
    );
    await ImportRowModel.insertMany(
      rows.map((r, seq) => ({
        userId,
        batchId: batch!._id,
        seq,
        rowId: r.id,
        kind: kinds.get(r.id) ?? "problem",
        normalized: r,
        hash: r.hash,
        alreadyImported: imported.has(r.hash),
      })),
      { session },
    );
    return { batchId: String(batch!._id) };
  });
}

function categoryLabel(c: CategoryDoc, byId: Map<string, CategoryDoc>): string {
  const parent = c.parentId ? byId.get(String(c.parentId)) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

function defaultState(
  ctx: Ctx,
  rows: readonly MmRow[],
  existing: Existing,
  saved: readonly ImportMappingDoc[],
): WizardState {
  const c = classifyRows(rows);
  const savedOf = (kind: ImportMappingDoc["kind"], key: string) =>
    saved.find((m) => m.kind === kind && m.sourceKey === key)?.action;
  const accountIds = new Set(existing.accounts.map((a) => String(a._id)));
  const holdingIds = new Set(existing.holdings.map((h) => String(h._id)));
  const categoryIds = new Set(existing.categories.map((x) => String(x._id)));

  const accounts: WizardState["accounts"] = {};
  const summaries = summariseAccounts(rows);
  for (const s of summaries) {
    const prior = savedOf("account", s.key) as AccountChoice | undefined;
    if (prior) {
      const valid =
        prior.treatAs === "ignore" ||
        (prior.treatAs === "merge" && summaries.some((x) => x.key === prior.into)) ||
        (prior.treatAs === "account" && prior.existingId && accountIds.has(prior.existingId)) ||
        (prior.treatAs === "holding" && prior.existingId && holdingIds.has(prior.existingId));
      if (valid) {
        accounts[s.key] = prior;
        continue;
      }
    }
    const account = existing.accounts.find((a) => nameKey(a.name) === s.key);
    if (account) {
      accounts[s.key] = { treatAs: "account", existingId: String(account._id), create: null };
      continue;
    }
    const holding = existing.holdings.find((h) => nameKey(h.name) === s.key && !h.fd);
    if (holding) {
      accounts[s.key] = { treatAs: "holding", existingId: String(holding._id), create: null };
      continue;
    }
    const hint = suggestAccount(s.name);
    if (hint.treatAs === "account") {
      accounts[s.key] = {
        treatAs: "account",
        existingId: null,
        create: { name: s.name, type: hint.type, currency: ctx.baseCurrency },
      };
    } else {
      const cls =
        existing.assetClasses.find((a) => a.name === hint.assetClass) ?? existing.assetClasses[0];
      accounts[s.key] = cls
        ? {
            treatAs: "holding",
            existingId: null,
            create: {
              name: s.name,
              assetClassId: String(cls._id),
              instrumentType: hint.instrument,
              liquidity:
                hint.instrument === "money_market"
                  ? "high"
                  : hint.instrument === "fd"
                    ? "low"
                    : "medium",
            },
          }
        : {
            treatAs: "account",
            existingId: null,
            create: { name: s.name, type: "wallet", currency: ctx.baseCurrency },
          };
    }
  }

  const categories = (kind: CategoryKind, source: readonly MmRow[]) => {
    const out: Record<string, CategoryChoice> = {};
    const mine = existing.categories.filter((x) => x.kind === kind && !x.isSystem);
    for (const node of categoryTree(source)) {
      const prior = savedOf(`${kind}_category`, node.key) as CategoryChoice | undefined;
      if (
        prior &&
        (prior.action !== "existing" || categoryIds.has(prior.existingId)) &&
        prior.action !== "unset"
      ) {
        out[node.key] = prior;
        continue;
      }
      let match: CategoryDoc | undefined;
      if (!node.parentKey) {
        match = mine.find((x) => !x.parentId && nameKey(x.name) === node.key);
      } else {
        const parent = out[node.parentKey];
        if (parent?.action === "existing") {
          match = mine.find(
            (x) =>
              String(x.parentId) === parent.existingId && nameKey(x.name) === nameKey(node.name),
          );
        }
      }
      out[node.key] = match
        ? { action: "existing", existingId: String(match._id) }
        : { action: "create", name: node.name || "Uncategorised", isEssential: false };
    }
    return out;
  };

  return {
    accounts,
    expenseCategories: categories("expense", c.expenses),
    incomeCategories: categories("income", c.incomes),
    skipRowIds: [],
    detachFeeIds: [],
    openings: {},
  };
}

// --------------------------------------------------------------------------------- wizard

const rowRef = (r: MmRow): WizardRowRef => ({
  id: r.id,
  date: r.wallClock.replace("T", " "),
  account: r.account,
  category: r.subcategory ? `${r.category} › ${r.subcategory}` : r.category,
  type: r.type ?? "",
  amountMinor: r.amountMinor,
  note: r.note,
  description: r.description,
});

export async function getWizardData(ctx: Ctx, batchId: unknown): Promise<WizardData> {
  const { batchId: id } = parseInput(batchIdSchema, { batchId });
  await connectDb();
  const batch = await loadBatch(ctx, id);
  const rows = await loadRows(ctx, batch._id, true);
  const total = await ImportRowModel.countDocuments({ userId: batch.userId, batchId: batch._id });
  const c = classifyRows(rows);
  const existing = await loadExisting(ctx);
  const byId = new Map(existing.categories.map((x) => [String(x._id), x]));
  const state = wizardStateSchema.parse(batch.mapping);
  const expenseNodes = categoryTree(c.expenses);
  const incomeNodes = categoryTree(c.incomes);

  return {
    batchId: String(batch._id),
    status: batch.status,
    files: batch.files,
    warnings: batch.warnings,
    baseCurrency: ctx.baseCurrency,
    counts: {
      total,
      alreadyImported: total - rows.length,
      toImport: rows.length,
    },
    accounts: summariseAccounts(rows).map((s) => ({
      ...s,
      samples: rows
        .filter((r) => r.accountKey === s.key)
        .slice(0, 5)
        .map((r) => ({
          date: r.date,
          type: r.type ?? "",
          category: r.category,
          amountMinor: r.amountMinor,
          note: r.note,
        })),
    })),
    expenseCategories: expenseNodes,
    incomeCategories: incomeNodes,
    hints: { expense: mergeHints(expenseNodes), income: mergeHints(incomeNodes) },
    transfers: c.pairs.map((p) => ({
      out: rowRef(p.out),
      in: rowRef(p.in),
      fee: p.fee ? rowRef(p.fee) : null,
    })),
    standaloneFees: c.standaloneFees.map(rowRef),
    ambiguousFeeIds: c.ambiguousFees.map((f) => f.id),
    differences: c.differences.map(rowRef),
    problems: c.problems.map((p) => ({ row: rowRef(p.row), reason: p.reason })),
    state,
    options: {
      accounts: existing.accounts.map((a) => ({
        id: String(a._id),
        name: a.name,
        type: a.type,
        currency: a.currency,
        openingDate: utcToBusinessDate(a.openingDate, ctx.tz),
      })),
      holdings: existing.holdings.map((h) => ({
        id: String(h._id),
        name: h.name,
        currency: h.currency,
        isFd: Boolean(h.fd),
      })),
      expenseCategories: existing.categories
        .filter((x) => x.kind === "expense" && !x.isSystem)
        .map((x) => ({ id: String(x._id), label: categoryLabel(x, byId) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      incomeCategories: existing.categories
        .filter((x) => x.kind === "income" && !x.isSystem)
        .map((x) => ({ id: String(x._id), label: categoryLabel(x, byId) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      assetClasses: existing.assetClasses.map((a) => ({ id: String(a._id), name: a.name })),
    },
  };
}

export async function saveImportMapping(ctx: Ctx, input: unknown): Promise<{ saved: true }> {
  const data = parseInput(saveMappingSchema, input);
  await connectDb();
  const batch = await loadBatch(ctx, data.batchId);
  if (batch.status === "imported" || batch.status === "reverted") {
    throw new AppError(
      "CONFLICT",
      "This import is finished; start a new one to change the mapping",
    );
  }
  await ImportBatchModel.updateOne(
    { _id: batch._id, userId: batch.userId },
    { $set: { mapping: data.state, status: "draft" } },
  );
  return { saved: true };
}

// -------------------------------------------------------------------------------- planning

interface Built {
  batch: ImportBatchDoc;
  rows: MmRow[];
  classified: Classified;
  state: WizardState;
  mapping: ImportMapping;
  plan: PostingPlan;
  existing: Existing;
  blockers: string[];
  warnings: string[];
  /** Opening date and balance per new target account ref. */
  openings: Map<string, { date: string; balanceMinor: number }>;
  /** Existing accounts whose opening date moves earlier. */
  moveOpening: Map<string, string>;
  /** Category refs to create, parents first. */
  newCategories: {
    ref: string;
    kind: CategoryKind;
    name: string;
    icon: string | null;
    isEssential: boolean;
    parentRef: string | null;
  }[];
  names: Map<string, string>;
}

function toCategoryMapping(
  kind: CategoryKind,
  choices: Record<string, CategoryChoice>,
): Record<string, CategoryMapping> {
  const out: Record<string, CategoryMapping> = {};
  for (const [key, ch] of Object.entries(choices)) {
    if (ch.action === "existing") out[key] = { ref: ch.existingId };
    else if (ch.action === "create") out[key] = { ref: newCategoryRef(kind, key) };
    else if (ch.action === "merge") out[key] = { merge: ch.into };
    else if (ch.action === "uncategorised") out[key] = { uncategorised: true };
  }
  return out;
}

async function buildImport(
  ctx: Ctx,
  batchId: string,
  session: ClientSession | null,
): Promise<Built> {
  const batch = await loadBatch(ctx, batchId, session);
  const rows = await loadRows(ctx, batch._id, true, session);
  const state = wizardStateSchema.parse(batch.mapping);
  const existing = await loadExisting(ctx, session);
  const c = classifyRows(rows);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const names = new Map<string, string>();

  const accountById = new Map(existing.accounts.map((a) => [String(a._id), a]));
  const holdingById = new Map(existing.holdings.map((h) => [String(h._id), h]));
  const categoryById = new Map(existing.categories.map((x) => [String(x._id), x]));
  const summaries = summariseAccounts(rows);
  const nameOfKey = new Map(summaries.map((s) => [s.key, s.name]));

  const accountsMap: ImportMapping["accounts"] = {};
  for (const s of summaries) {
    const ch = state.accounts[s.key];
    if (!ch) {
      blockers.push(`Choose what "${s.name}" becomes`);
      continue;
    }
    if (ch.treatAs === "ignore") accountsMap[s.key] = { treatAs: "ignore" };
    else if (ch.treatAs === "merge") {
      if (!nameOfKey.has(ch.into) || ch.into === s.key)
        blockers.push(`"${s.name}" merges into an unknown account`);
      accountsMap[s.key] = { treatAs: "merge", into: ch.into };
    } else if (ch.existingId) {
      if (ch.treatAs === "account") {
        const a = accountById.get(ch.existingId);
        if (!a) blockers.push(`The account chosen for "${s.name}" no longer exists`);
        else {
          names.set(ch.existingId, a.name);
          if (a.currency !== ctx.baseCurrency) {
            blockers.push(
              `"${a.name}" is in ${a.currency}; Money Manager rows are in ${ctx.baseCurrency}`,
            );
          }
        }
      } else {
        const h = holdingById.get(ch.existingId);
        if (!h) blockers.push(`The holding chosen for "${s.name}" no longer exists`);
        else {
          names.set(ch.existingId, h.name);
          if (h.fd)
            blockers.push(
              `"${h.name}" has deposit terms, so its value is calculated and Money Manager cannot set it — choose another holding`,
            );
          if (h.currency !== ctx.baseCurrency) blockers.push(`"${h.name}" is in ${h.currency}`);
        }
      }
      accountsMap[s.key] = { treatAs: ch.treatAs, ref: ch.existingId };
    } else if (ch.create) {
      const ref = newAccountRef(s.key);
      names.set(ref, ch.create.name);
      if ("currency" in ch.create && ch.create.currency !== ctx.baseCurrency) {
        blockers.push(
          `New account "${ch.create.name}" must be in ${ctx.baseCurrency} to take these rows`,
        );
      }
      accountsMap[s.key] = { treatAs: ch.treatAs, ref };
    } else {
      blockers.push(`Choose or create a target for "${s.name}"`);
    }
  }
  const mapping: ImportMapping = {
    accounts: accountsMap,
    expenseCategories: toCategoryMapping("expense", state.expenseCategories),
    incomeCategories: toCategoryMapping("income", state.incomeCategories),
    skipRowIds: state.skipRowIds,
    detachFeeIds: state.detachFeeIds,
  };
  for (const s of summaries) {
    if (accountsMap[s.key]?.treatAs === "merge" && !resolveAccount(mapping, s.key)) {
      const m = accountsMap[s.key];
      const end = m?.treatAs === "merge" ? accountsMap[m.into] : undefined;
      if (end?.treatAs !== "ignore") blockers.push(`"${s.name}" merges in a circle`);
    }
  }

  // Categories: every node used by a row needs a decision; created subcategories go under their parent.
  const newCategories: Built["newCategories"] = [];
  for (const [kind, choices, source] of [
    ["expense", state.expenseCategories, c.expenses],
    ["income", state.incomeCategories, c.incomes],
  ] as const) {
    const nodes = categoryTree(source);
    const nodeByKey = new Map(nodes.map((n) => [n.key, n]));
    for (const n of nodes) {
      const ch = choices[n.key];
      const label = n.parentKey ? `${nodeByKey.get(n.parentKey)?.name ?? ""} › ${n.name}` : n.name;
      if (!ch || ch.action === "unset") {
        blockers.push(`Choose what the ${kind} category "${label}" becomes`);
        continue;
      }
      if (ch.action === "existing") {
        const doc = categoryById.get(ch.existingId);
        if (!doc || doc.kind !== kind)
          blockers.push(`The category chosen for "${label}" is not an active ${kind} category`);
      }
      if (ch.action === "merge" && !nodeByKey.has(ch.into)) {
        blockers.push(`"${label}" merges into an unknown category`);
      }
      if (ch.action === "create") {
        let parentRef: string | null = null;
        if (n.parentKey) {
          const p = choices[n.parentKey];
          if (p?.action === "create") parentRef = newCategoryRef(kind, n.parentKey);
          if (p?.action === "existing") {
            const doc = categoryById.get(p.existingId);
            parentRef = doc ? String(doc.parentId ?? doc._id) : null;
          }
        }
        newCategories.push({
          ref: newCategoryRef(kind, n.key),
          kind,
          name: ch.name,
          icon: n.icon,
          isEssential: kind === "expense" && ch.isEssential,
          parentRef,
        });
      }
    }
  }
  newCategories.sort(
    (a, b) =>
      Number(a.parentRef?.startsWith(NEW) ?? false) - Number(b.parentRef?.startsWith(NEW) ?? false),
  );

  // Openings: new accounts open on their first row (start of day) with the chosen balance; existing
  // accounts keep theirs unless the user moves the opening date to cover older rows.
  const firstPass = buildPostingPlan(c, mapping);
  const openings = new Map<string, { date: string; balanceMinor: number }>();
  const moveOpening = new Map<string, string>();
  const openingBalances: Record<string, number> = {};
  for (const [ref, first] of firstPass.firstDates) {
    const chosen = state.openings[ref];
    if (ref.startsWith(NEW)) {
      const date = chosen?.date ?? first;
      if (date > first)
        blockers.push(`"${names.get(ref)}" opens on ${date}, after its first row (${first})`);
      openings.set(ref, { date, balanceMinor: chosen?.balanceMinor ?? 0 });
      openingBalances[ref] = chosen?.balanceMinor ?? 0;
    } else {
      const a = accountById.get(ref);
      if (!a) continue;
      openingBalances[ref] = a.balanceMinor;
      const opened = utcToBusinessDate(a.openingDate, ctx.tz);
      if (first < opened) {
        if (chosen?.date && chosen.date <= first) moveOpening.set(ref, chosen.date);
        else
          blockers.push(
            `"${a.name}" has rows from ${first}, before its opening date ${opened}: move its opening date in step 6`,
          );
      }
    }
  }

  // Existing holdings continue from their current state, and only forward in time.
  const holdingStart: Record<string, { valueMinor: number; investedMinor: number }> = {};
  const firstHoldingDate = new Map<string, string>();
  for (const op of firstPass.ops) {
    if ("holding" in op && !op.holding.startsWith(NEW) && !firstHoldingDate.has(op.holding)) {
      firstHoldingDate.set(op.holding, op.date);
    }
  }
  for (const [ref, first] of firstHoldingDate) {
    const h = holdingById.get(ref);
    if (!h) continue;
    holdingStart[ref] = { valueMinor: h.currentValueMinor, investedMinor: h.investedMinor };
    const userId = toObjectId(ctx.userId, "User");
    const from = businessDateToUtc(first, ctx.tz);
    const [later, laterValue] = await Promise.all([
      TransactionModel.countDocuments({
        userId,
        holdingId: h._id,
        status: "posted",
        date: { $gt: from },
      }).session(session),
      ValuationModel.countDocuments({ userId, holdingId: h._id, date: { $gt: from } }).session(
        session,
      ),
    ]);
    if (later + laterValue > 0) {
      blockers.push(
        `"${h.name}" already has entries after ${first}; import into an empty holding or one that ends before the file starts`,
      );
    }
  }

  const plan = buildPostingPlan(c, mapping, openingBalances, holdingStart);
  const unmapped = plan.skipped.filter((s) => s.reason === "Category not mapped").length;
  if (unmapped)
    blockers.push(`${unmapped} rows have a category that merges in a circle or into nothing`);
  if (c.problems.length) warnings.push(`${c.problems.length} problem rows will be skipped`);
  if (c.ambiguousFees.length) {
    warnings.push(
      `${c.ambiguousFees.length} fees matched several transfers and are imported as "Bank fees"`,
    );
  }
  const sameTarget = plan.skipped.filter(
    (s) => s.reason === "Both sides map to the same place",
  ).length;
  if (sameTarget)
    warnings.push(`${sameTarget} transfers move money within one target and are left out`);
  const ignored = plan.skipped.filter((s) => s.reason === "One side is an ignored account").length;
  if (ignored) warnings.push(`${ignored} transfers touch an ignored account and are left out`);

  return {
    batch,
    rows,
    classified: c,
    state,
    mapping,
    plan,
    existing,
    blockers,
    warnings,
    openings,
    moveOpening,
    newCategories,
    names,
  };
}

/** Income/expense per month: Money Manager's rows (not transfers, not Difference) vs the plan. */
function monthlyTotals(b: Built): PreviewData["monthly"] {
  const skipped = new Set(b.plan.skipped.flatMap((s) => s.rowIds));
  const months = new Map<string, PreviewData["monthly"][number]>();
  const at = (date: string) => {
    const m = date.slice(0, 7);
    const v = months.get(m) ?? {
      month: m,
      sheetIncomeMinor: 0,
      sheetExpenseMinor: 0,
      incomeMinor: 0,
      expenseMinor: 0,
    };
    months.set(m, v);
    return v;
  };
  for (const r of b.classified.rows) {
    if (r.problems.length || isDifferenceRow(r) || skipped.has(r.id)) continue;
    if (r.type === "Income") at(r.date).sheetIncomeMinor += r.amountMinor;
    if (r.type === "Exp.") at(r.date).sheetExpenseMinor += r.amountMinor;
  }
  for (const op of b.plan.ops) {
    if (op.op === "income") at(op.date).incomeMinor += op.amountMinor;
    if (op.op === "expense") at(op.date).expenseMinor += op.amountMinor;
    if ((op.op === "transfer" || op.op === "invest" || op.op === "redeem") && op.feeMinor) {
      at(op.date).expenseMinor += op.feeMinor;
    }
  }
  return [...months.values()].sort((a, z) => a.month.localeCompare(z.month));
}

function previewOf(ctx: Ctx, b: Built): PreviewData {
  const mm = mmBalancesByTarget(
    b.rows.filter((r) => !r.problems.length),
    b.mapping,
    Object.fromEntries(
      [...b.plan.firstDates.keys()].map((ref) => [
        ref,
        ref.startsWith(NEW)
          ? (b.openings.get(ref)?.balanceMinor ?? 0)
          : (b.existing.accounts.find((a) => String(a._id) === ref)?.balanceMinor ?? 0),
      ]),
    ),
  );
  const balances: PreviewLine[] = [...b.plan.firstDates.entries()].map(([ref, first]) => {
    const existing = b.existing.accounts.find((a) => String(a._id) === ref);
    return {
      ref,
      name: b.names.get(ref) ?? ref,
      isNew: ref.startsWith(NEW),
      firstDate: first,
      openingDate: existing
        ? (b.moveOpening.get(ref) ?? utcToBusinessDate(existing.openingDate, ctx.tz))
        : (b.openings.get(ref)?.date ?? first),
      openingBalanceMinor: existing
        ? existing.openingBalanceMinor
        : (b.openings.get(ref)?.balanceMinor ?? 0),
      wealthTrackMinor: b.plan.accountBalances.get(ref) ?? 0,
      moneyManagerMinor: mm.get(ref) ?? 0,
      currency: existing?.currency ?? ctx.baseCurrency,
    };
  });
  balances.sort((a, z) => a.name.localeCompare(z.name));
  const ops: Record<string, number> = {};
  for (const op of b.plan.ops) {
    const k = op.op === "valuation" ? `valuation_${op.reason}` : op.op;
    ops[k] = (ops[k] ?? 0) + 1;
  }
  const newHoldings = Object.entries(b.state.accounts)
    .filter(
      ([key, ch]) =>
        ch.treatAs === "holding" && !ch.existingId && ch.create && b.mapping.accounts[key],
    )
    .map(([, ch]) => (ch.treatAs === "holding" ? ch.create!.name : ""));
  const newAccounts = Object.entries(b.state.accounts)
    .filter(
      ([key, ch]) =>
        ch.treatAs === "account" && !ch.existingId && ch.create && b.mapping.accounts[key],
    )
    .map(([, ch]) => (ch.treatAs === "account" ? ch.create!.name : ""));
  return {
    batchId: String(b.batch._id),
    blockers: b.blockers,
    warnings: [...b.batch.warnings, ...b.warnings],
    create: {
      accounts: newAccounts,
      holdings: newHoldings,
      categories: b.newCategories.map((x) => `${x.name} (${x.kind})`),
    },
    ops,
    skipped: b.plan.skipped,
    balances,
    holdings: [...b.plan.holdingValues.entries()].map(([ref, valueMinor]) => ({
      ref,
      name: b.names.get(ref) ?? ref,
      valueMinor,
    })),
    monthly: monthlyTotals(b),
  };
}

/** Dry run: nothing is written to the ledger. Marks the batch previewed when nothing blocks it. */
export async function previewImport(ctx: Ctx, batchId: unknown): Promise<PreviewData> {
  const { batchId: id } = parseInput(batchIdSchema, { batchId });
  await connectDb();
  const built = await buildImport(ctx, id, null);
  if (built.batch.status === "imported" || built.batch.status === "reverted") {
    throw new AppError("CONFLICT", "This import is already finished");
  }
  const preview = previewOf(ctx, built);
  await ImportBatchModel.updateOne(
    { _id: built.batch._id, userId: built.batch.userId },
    {
      $set: {
        status: preview.blockers.length ? "draft" : "previewed",
        summary: { ops: preview.ops, skipped: preview.skipped.length },
      },
    },
  );
  return preview;
}

// ---------------------------------------------------------------------------------- commit

/**
 * Commit (docs/07 §3 step 8): ONE DB transaction creates the declared accounts, categories and
 * holdings, posts the plan in chronological order and saves the mapping for the next file. Any
 * failure rolls everything back.
 */
export async function commitImport(ctx: Ctx, input: unknown): Promise<ImportResult> {
  const data = parseInput(commitSchema, input);
  return withTransaction(async (session) => {
    const b = await buildImport(ctx, data.batchId, session);
    if (b.batch.status === "imported")
      throw new AppError("CONFLICT", "This file is already imported");
    if (b.batch.status === "reverted")
      throw new AppError("CONFLICT", "This import was undone; upload the file again");
    if (b.blockers.length) {
      throw new AppError("VALIDATION", `Fix the mapping first: ${b.blockers[0]}`);
    }
    const userId = toObjectId(ctx.userId, "User");
    const refs = new Map<string, Types.ObjectId>();
    const created = {
      accountIds: [] as Types.ObjectId[],
      categoryIds: [] as Types.ObjectId[],
      holdingIds: [] as Types.ObjectId[],
    };

    // 1. Accounts and holdings declared in the mapping (only those the plan uses).
    const used = new Set<string>();
    for (const op of b.plan.ops) {
      for (const k of ["account", "from", "to", "holding"] as const) {
        const v = (op as Record<string, unknown>)[k];
        if (typeof v === "string" && v) used.add(v);
      }
    }
    for (const [key, ch] of Object.entries(b.state.accounts)) {
      const ref = newAccountRef(key);
      if (
        !used.has(ref) ||
        (ch.treatAs !== "account" && ch.treatAs !== "holding") ||
        ch.existingId ||
        !ch.create
      )
        continue;
      if (ch.treatAs === "account") {
        const opening = b.openings.get(ref) ?? {
          date: b.plan.firstDates.get(ref)!,
          balanceMinor: 0,
        };
        const [doc] = await AccountModel.create(
          [
            {
              userId,
              name: ch.create.name,
              type: ch.create.type,
              currency: ch.create.currency,
              openingBalanceMinor: opening.balanceMinor,
              openingDate: businessDateToUtc(opening.date, ctx.tz),
              balanceMinor: opening.balanceMinor,
              counterparty:
                ch.create.type === "receivable" || ch.create.type === "payable"
                  ? ch.create.name
                  : null,
              notes: "Created by the Money Manager import",
            },
          ],
          { session },
        );
        refs.set(ref, doc!._id);
        created.accountIds.push(doc!._id);
      } else {
        const cls = b.existing.assetClasses.find((a) => String(a._id) === ch.create!.assetClassId);
        if (!cls)
          throw new AppError("VALIDATION", `Choose an active asset class for "${ch.create.name}"`);
        const [doc] = await HoldingModel.create(
          [
            {
              userId,
              name: ch.create.name,
              assetClassId: cls._id,
              instrumentType: ch.create.instrumentType,
              currency: ctx.baseCurrency,
              liquidity: ch.create.liquidity,
              trackUnits: false,
              notes: "Created by the Money Manager import",
            },
          ],
          { session },
        );
        refs.set(ref, doc!._id);
        created.holdingIds.push(doc!._id);
      }
    }
    for (const [ref, date] of b.moveOpening) {
      await AccountModel.updateOne(
        { _id: toObjectId(ref, "Account"), userId },
        { $set: { openingDate: businessDateToUtc(date, ctx.tz) } },
        { session },
      );
    }

    // 2. Categories (parents first); an existing same-name category is reused, never duplicated.
    for (const nc of b.newCategories) {
      const parentId = nc.parentRef
        ? nc.parentRef.startsWith(NEW)
          ? (refs.get(nc.parentRef) ?? null)
          : toObjectId(nc.parentRef, "Category")
        : null;
      const same = await CategoryModel.findOne({
        userId,
        kind: nc.kind,
        parentId,
        archivedAt: null,
        name: new RegExp(`^${nc.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      })
        .session(session)
        .lean<CategoryDoc>();
      if (same) {
        refs.set(nc.ref, same._id);
        continue;
      }
      const [doc] = await CategoryModel.create(
        [
          {
            userId,
            name: nc.name,
            kind: nc.kind,
            parentId,
            icon: nc.icon,
            isEssential: nc.isEssential,
          },
        ],
        { session },
      );
      refs.set(nc.ref, doc!._id);
      created.categoryIds.push(doc!._id);
    }
    const system = {
      bankFees: await getSystemCategoryId(ctx, SYSTEM_CATEGORY.bankFees, "expense", session),
      uncategorisedExpense: await getSystemCategoryId(
        ctx,
        SYSTEM_CATEGORY.uncategorised,
        "expense",
        session,
      ),
      uncategorisedIncome: await getSystemCategoryId(
        ctx,
        SYSTEM_CATEGORY.uncategorised,
        "income",
        session,
      ),
    };

    // 3. Ledger entries in plan (chronological) order.
    const id = (ref: string, what: string): Types.ObjectId => {
      if (ref.startsWith(NEW)) {
        const v = refs.get(ref);
        if (!v) throw new AppError("INTERNAL", `${what} ${ref} was not created`);
        return v;
      }
      return toObjectId(ref, what);
    };
    const categoryIdOf = (ref: string, kind: CategoryKind) => {
      if (ref === "system:bank_fees") return system.bankFees;
      if (ref === UNCATEGORISED)
        return kind === "income" ? system.uncategorisedIncome : system.uncategorisedExpense;
      return id(ref, "Category");
    };
    const existingHashes = new Set(
      (
        await TransactionModel.find({ userId, importHash: { $in: b.plan.ops.map((o) => o.hash) } })
          .select({ importHash: 1 })
          .session(session)
          .lean<{ importHash: string }[]>()
      ).map((t) => t.importHash),
    );
    const groups = new Map<string, Types.ObjectId>();
    const group = (g?: string) => {
      if (!g) return null;
      if (!groups.has(g)) groups.set(g, new Types.ObjectId());
      return groups.get(g)!;
    };
    const entries: ImportEntry[] = b.plan.ops
      .filter((op) => op.op === "valuation" || !existingHashes.has(op.hash))
      .flatMap((op): ImportEntry[] => entryOf(op, ctx, id, categoryIdOf, group));
    if (!entries.length) throw new AppError("VALIDATION", "Nothing new to import");

    const batchId = b.batch._id;
    const posted = await postImportBatch(ctx, batchId, entries, session);

    // 4. Remember the mapping for the next file (created items replaced by their ids).
    const writes = [
      ...Object.entries(b.state.accounts).map(([key, ch]) => {
        let action: AccountChoice = ch;
        if ((ch.treatAs === "account" || ch.treatAs === "holding") && !ch.existingId) {
          const made = refs.get(newAccountRef(key));
          if (!made) return null;
          action = { treatAs: ch.treatAs, existingId: String(made), create: null } as AccountChoice;
        }
        return { kind: "account" as const, key, action };
      }),
      ...(["expense", "income"] as const).flatMap((kind) =>
        Object.entries(
          kind === "expense" ? b.state.expenseCategories : b.state.incomeCategories,
        ).map(([key, ch]) => {
          let action: CategoryChoice = ch;
          if (ch.action === "create") {
            const made = refs.get(newCategoryRef(kind, key));
            if (!made) return null;
            action = { action: "existing", existingId: String(made) };
          }
          return { kind: `${kind}_category` as const, key, action };
        }),
      ),
    ].filter(
      (w): w is NonNullable<typeof w> =>
        w !== null && (w.action as { action?: string }).action !== "unset",
    );
    if (writes.length) {
      await ImportMappingModel.bulkWrite(
        writes.map((w) => ({
          updateOne: {
            filter: { userId, source: MM_SOURCE, kind: w.kind, sourceKey: w.key },
            update: { $set: { action: w.action, updatedAt: new Date() } },
            upsert: true,
          },
        })),
        { session },
      );
    }

    const result: ImportResult = {
      batchId: String(batchId),
      transactions: posted.transactions,
      valuations: posted.valuations,
      created: {
        accounts: created.accountIds.length,
        categories: created.categoryIds.length,
        holdings: created.holdingIds.length,
      },
    };
    await ImportBatchModel.updateOne(
      { _id: batchId, userId },
      {
        $set: {
          status: "imported",
          importedAt: new Date(),
          createdItems: created,
          summary: { ...result, skipped: b.plan.skipped.length },
        },
      },
      { session },
    );
    await writeAudit(
      {
        userId: ctx.userId,
        action: "commit",
        entity: "importBatch",
        entityId: batchId,
        after: result,
      },
      session,
    );
    return result;
  });
}

function entryOf(
  op: PlanOp,
  ctx: Ctx,
  id: (ref: string, what: string) => Types.ObjectId,
  categoryIdOf: (ref: string, kind: CategoryKind) => Types.ObjectId,
  group: (g?: string) => Types.ObjectId | null,
): ImportEntry[] {
  const date = businessDateToUtc(op.date, ctx.tz);
  const importHash = op.hash;
  switch (op.op) {
    case "expense":
    case "income":
      return [
        {
          kind: "txn",
          type: op.op,
          date,
          amountMinor: op.amountMinor,
          ...(op.op === "expense"
            ? { fromAccountId: id(op.account, "Account") }
            : { toAccountId: id(op.account, "Account") }),
          categoryId: categoryIdOf(op.category, op.op),
          description: op.description,
          notes: op.notes,
          importHash,
        },
      ];
    case "transfer":
      return [
        {
          kind: "txn",
          type: "transfer",
          date,
          amountMinor: op.amountMinor,
          feeMinor: op.feeMinor,
          fromAccountId: id(op.from, "Account"),
          toAccountId: id(op.to, "Account"),
          description: op.description,
          importHash,
        },
      ];
    case "invest":
      return [
        {
          kind: "txn",
          type: "invest",
          date,
          amountMinor: op.amountMinor,
          feeMinor: op.feeMinor,
          fromAccountId: op.from ? id(op.from, "Account") : null,
          holdingId: id(op.holding, "Holding"),
          description: op.description,
          importHash,
          groupId: group(op.group),
        },
      ];
    case "redeem":
      return [
        {
          kind: "txn",
          type: "redeem",
          date,
          amountMinor: op.amountMinor,
          feeMinor: op.feeMinor,
          toAccountId: op.to ? id(op.to, "Account") : null,
          holdingId: id(op.holding, "Holding"),
          description: op.description,
          importHash,
          groupId: group(op.group),
        },
      ];
    case "adjustment":
      return [
        {
          kind: "txn",
          type: "adjustment",
          date,
          amountMinor: op.amountMinor,
          ...(op.direction === "to"
            ? { toAccountId: id(op.account, "Account") }
            : { fromAccountId: id(op.account, "Account") }),
          description: op.description,
          importHash,
        },
      ];
    case "opening":
      if (op.investedMinor <= 0) return [];
      return [
        {
          kind: "txn",
          type: "opening_balance",
          date,
          amountMinor: op.investedMinor,
          holdingId: id(op.holding, "Holding"),
          description: "Opening value (Money Manager)",
          importHash,
        },
      ];
    case "valuation":
      return [
        {
          kind: "valuation",
          holdingId: id(op.holding, "Holding"),
          date,
          valueMinor: op.valueMinor,
          note:
            op.reason === "difference"
              ? "Money Manager balance difference"
              : "Value before redemption (Money Manager)",
        },
      ];
  }
}

// ------------------------------------------------------------------------------------ undo

/**
 * Undo (docs/07 §4): voids the batch's transactions, removes its valuations and recomputes caches,
 * in one DB transaction. Optionally archives the accounts, categories and holdings it created when
 * nothing else uses them (archived, not deleted, so voided history keeps its references).
 */
export async function undoImport(
  ctx: Ctx,
  input: unknown,
): Promise<{ voided: number; archived: number }> {
  const data = parseInput(undoSchema, input);
  return withTransaction(async (session) => {
    const batch = await loadBatch(ctx, data.batchId, session);
    if (batch.status !== "imported")
      throw new AppError("CONFLICT", "Only a finished import can be undone");
    const userId = toObjectId(ctx.userId, "User");
    const { voided } = await voidImportBatch(ctx, batch._id, session);
    let archived = 0;
    if (data.archiveCreated) {
      const now = new Date();
      for (const accountId of batch.createdItems.accountIds) {
        const inUse = await TransactionModel.exists({
          userId,
          status: "posted",
          $or: [{ fromAccountId: accountId }, { toAccountId: accountId }],
        }).session(session);
        if (inUse) continue;
        await AccountModel.updateOne(
          { _id: accountId, userId },
          { $set: { archivedAt: now } },
          { session },
        );
        archived += 1;
      }
      for (const holdingId of batch.createdItems.holdingIds) {
        const [txn, value] = await Promise.all([
          TransactionModel.exists({ userId, status: "posted", holdingId }).session(session),
          ValuationModel.exists({ userId, holdingId }).session(session),
        ]);
        if (txn || value) continue;
        await HoldingModel.updateOne(
          { _id: holdingId, userId },
          { $set: { status: "closed", closedAt: now } },
          { session },
        );
        archived += 1;
      }
      for (const categoryId of batch.createdItems.categoryIds) {
        const [txn, child] = await Promise.all([
          TransactionModel.exists({
            userId,
            status: "posted",
            $or: [{ categoryId }, { "splits.categoryId": categoryId }],
          }).session(session),
          CategoryModel.exists({
            userId,
            parentId: categoryId,
            archivedAt: null,
            _id: { $nin: batch.createdItems.categoryIds },
          }).session(session),
        ]);
        if (txn || child) continue;
        await CategoryModel.updateOne(
          { _id: categoryId, userId },
          { $set: { archivedAt: now } },
          { session },
        );
        archived += 1;
      }
    }
    await ImportBatchModel.updateOne(
      { _id: batch._id, userId },
      { $set: { status: "reverted", revertedAt: new Date() } },
      { session },
    );
    return { voided, archived };
  });
}

export interface ImportBatchListItem {
  id: string;
  status: ImportBatchDoc["status"];
  files: string[];
  createdAt: string;
  importedAt: string | null;
  transactions: number | null;
}

export async function listImportBatches(ctx: Ctx): Promise<ImportBatchListItem[]> {
  await connectDb();
  const docs = await ImportBatchModel.find({
    userId: toObjectId(ctx.userId, "User"),
    source: MM_SOURCE,
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean<ImportBatchDoc[]>();
  return docs.map((d) => ({
    id: String(d._id),
    status: d.status,
    files: [...new Set(d.files.map((f) => f.name))],
    createdAt: d.createdAt.toISOString(),
    importedAt: d.importedAt?.toISOString() ?? null,
    transactions: (d.summary as { transactions?: number } | null)?.transactions ?? null,
  }));
}
