import mongoose, { Types } from "mongoose";
import { afterEach, describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { computeNetWorthSeries } from "@/domain/series";
import { exportTransactionsCsv } from "@/modules/transactions/queries";
import { transactionFiltersSchema } from "@/modules/transactions/schemas";
import { updateTransaction } from "@/modules/transactions/service";
import {
  deleteAttachment,
  listAttachments,
  readAttachment,
  uploadAttachment,
} from "@/modules/attachments/service";
import {
  BACKUP_COLLECTIONS,
  exportBackup,
  restoreBackup,
  wipeUserData,
} from "@/modules/backup/service";
import { createCategoryRule, listCategoryRules } from "@/modules/categories/rules-service";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import { getBucketsInBase, listAccountBuckets, setEarmark } from "@/modules/earmarks/service";
import {
  analyzeBankCsv,
  commitBankImport,
  previewBankImport,
  undoBankImport,
} from "@/modules/imports/bank-service";
import { MonthlyReviewModel } from "@/modules/reports/model";
import {
  ensureMonthlyReview,
  getCategoriesReport,
  getInvestmentIncome,
  getMonthlySummary,
  getNetWorthHistory,
  getRealisedGains,
  shiftMonth,
} from "@/modules/reports/service";
import { reportCsv } from "@/modules/reports/csv";
import { AccountModel } from "@/modules/accounts/model";
import type { Ctx } from "@/server/ctx";
import { setStorageForTests } from "@/server/storage";
import { memoryStorage } from "@/server/storage/provider";
import {
  assetClassId,
  balanceOf,
  categoryId,
  makeAccount,
  makeHolding,
  makeUser,
  post,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const today = () => utcToBusinessDate(new Date(), "Asia/Colombo");
const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);

// ---------------------------------------------------------------------------------- bank CSV

const CSV = [
  "Date,Description,Amount",
  '02/01/2026,KEELLS SUPER Colombo,"-1,500.00"',
  '25/01/2026,Salary January,"100,000.00"',
  "26/01/2026,Coffee,-450.00",
  "26/01/2026,Coffee,-450.00",
  "27/01/2026,=HYPERLINK(evil),-10.00",
  "bad,Broken,1",
].join("\n");

describe("bank CSV import", () => {
  async function setup() {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, {
      name: "Bank",
      openingBalanceMinor: 1_000_000,
      openingDate: "2025-12-01",
    });
    await createCategoryRule(ctx, {
      matchField: "description",
      operator: "contains",
      pattern: "keells",
      categoryId: await categoryId(ctx, "Groceries"),
    });
    const a = await analyzeBankCsv(ctx, { fileName: "jan.csv", csvText: CSV });
    return { ctx, bank, mapping: a.mapping, analysis: a };
  }

  it("maps, previews with rules, imports, and re-importing the same file imports 0 rows", async () => {
    const { ctx, bank, mapping, analysis } = await setup();
    expect(analysis.headers).toEqual(["Date", "Description", "Amount"]);
    expect(mapping).toMatchObject({
      dateColumn: 0,
      descriptionColumn: 1,
      amountMode: "signed",
      amountColumn: 2,
      dateFormat: "dd/MM/yyyy",
    });
    const input = { fileName: "jan.csv", csvText: CSV, accountId: bank.id, mapping };
    const p = await previewBankImport(ctx, input);
    expect(p.rows).toHaveLength(5);
    expect(p.errors.map((e) => e.line)).toEqual([7]);
    const groceries = await categoryId(ctx, "Groceries");
    expect(p.rows[0]).toMatchObject({
      amountMinor: -150_000,
      categoryId: groceries,
      duplicate: false,
    });
    expect(p.rows[1]!.categoryId).toBe(p.uncategorised.income);
    expect(p.totals).toMatchObject({
      rows: 5,
      duplicates: 0,
      inMinor: 10_000_000,
      outMinor: 241_000,
    });

    const salary = await categoryId(ctx, "Salary");
    const r = await commitBankImport(ctx, {
      ...input,
      choices: [
        { line: 3, categoryId: salary },
        { line: 6, skip: true },
      ],
    });
    expect(r).toMatchObject({ imported: 4, duplicates: 0, skipped: 1 });
    expect(await balanceOf(ctx, bank.id)).toBe(1_000_000 - 150_000 + 10_000_000 - 90_000);

    // Same file again: all already imported (the skipped line is new and stays importable).
    const again = await previewBankImport(ctx, input);
    expect(again.totals.duplicates).toBe(4);
    await expect(
      commitBankImport(ctx, { ...input, choices: [{ line: 6, skip: true }] }),
    ).rejects.toThrow(/Nothing new to import/);
    // The analysis now remembers the account and mapping for the same columns.
    expect((await analyzeBankCsv(ctx, { fileName: "jan.csv", csvText: CSV })).accountId).toBe(
      bank.id,
    );

    // Undo → balance back; the same rows can be imported again.
    expect(await undoBankImport(ctx, r.batchId)).toEqual({ voided: 4 });
    expect(await balanceOf(ctx, bank.id)).toBe(1_000_000);
    expect((await previewBankImport(ctx, input)).totals.duplicates).toBe(0);
    await expect(undoBankImport(ctx, r.batchId)).rejects.toThrow(/already undone/);
  });

  it("a category of the wrong kind is refused; other users' accounts are not found", async () => {
    const { ctx, bank, mapping } = await setup();
    const input = { fileName: "jan.csv", csvText: CSV, accountId: bank.id, mapping };
    const salary = await categoryId(ctx, "Salary");
    await expect(
      commitBankImport(ctx, { ...input, choices: [{ line: 2, categoryId: salary }] }),
    ).rejects.toThrow(/Line 2: choose an expense category/);
    const other = await makeUser();
    await expect(previewBankImport(other, input)).rejects.toThrow(/not found/i);
    expect((await listCategoryRules(ctx))[0]).toMatchObject({
      pattern: "keells",
      categoryKind: "expense",
    });
  });
});

// ------------------------------------------------------------------------------------- backup

async function richUser() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, {
    name: "Bank",
    openingBalanceMinor: 50_000_000,
    openingDate: "2025-06-01",
  });
  await makeAccount(ctx, {
    name: "EF",
    openingBalanceMinor: 2_000_000,
    countsTowardEmergencyFund: true,
    openingDate: "2025-06-01",
  });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "emergency",
    mode: "fixed",
    amountMinor: 10_000_000,
  });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "opportunity",
    mode: "percent",
    percentBp: 2_000,
  });
  const fund = await makeHolding(ctx, { name: "Fund", openingDate: "2025-06-01" });
  await post(ctx, {
    type: "invest",
    date: "2025-07-01",
    amountMinor: 5_000_000,
    fromAccountId: bank.id,
    holdingId: fund.id,
  });
  await post(ctx, {
    type: "expense",
    date: "2025-08-01",
    amountMinor: 300_000,
    fromAccountId: bank.id,
    categoryId: await categoryId(ctx, "Groceries"),
  });
  await post(ctx, {
    type: "redeem",
    date: "2025-09-01",
    amountMinor: 1_000_000,
    toAccountId: bank.id,
    holdingId: fund.id,
  });
  return { ctx, bank };
}

async function standing(ctx: Ctx) {
  const input = await loadSeriesInput(ctx);
  const [p] = computeNetWorthSeries(input, [today()]);
  const buckets = await getBucketsInBase(ctx);
  const accounts = await AccountModel.find({ userId: uid(ctx) }).lean();
  const byAccount = await listAccountBuckets(ctx);
  const earmarks = accounts
    .map((a) => {
      const b = byAccount.get(String(a._id))!;
      return [
        a.name,
        b.emergencyMinor,
        b.opportunityMinor,
        b.freeMinor,
        b.earmarks.map((e) => [e.bucket, e.mode, e.amountMinor, e.percentBp]),
      ];
    })
    .sort();
  return {
    netWorth: p!.netWorthMinor,
    free: buckets.freeMinor,
    emergency: buckets.emergencyMinor,
    earmarks,
  };
}

describe("JSON backup / restore", () => {
  it("export → wipe → restore reproduces net worth, earmarks and free cash", async () => {
    const { ctx } = await richUser();
    const before = await standing(ctx);
    const { json, fileName } = await exportBackup(ctx);
    expect(fileName).toMatch(/^wealthtrack-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(json)).toMatchObject({ format: "wealthtrack-backup", version: 1 });

    await wipeUserData(ctx.userId);
    expect(await AccountModel.countDocuments({ userId: uid(ctx) })).toBe(0);
    const r = await restoreBackup(ctx, json);
    expect(r.collections.accounts).toBe(2);
    expect(r.collections.earmarks).toBe(2);
    expect(await standing(ctx)).toEqual(before);
  });

  it("restores into another (empty) account next to the original; refuses a non-empty account", async () => {
    const { ctx } = await richUser();
    const { json } = await exportBackup(ctx);
    const other = await makeUser();
    await restoreBackup(other, json);
    expect(await standing(other)).toEqual(await standing(ctx));
    // The original is untouched and the copy has its own ids.
    const a = await AccountModel.find({ userId: uid(ctx) }).lean();
    const b = await AccountModel.find({ userId: uid(other) }).lean();
    expect(a.map((x) => String(x._id))).not.toEqual(
      expect.arrayContaining(b.map((x) => String(x._id))),
    );
    await expect(restoreBackup(other, json)).rejects.toThrow(/only into an empty account/);
    await expect(restoreBackup(await makeUser(), '{"format":"x"}')).rejects.toThrow(
      /Not a WealthTrack backup/,
    );
  });

  it("every user-scoped collection is in the backup", () => {
    const names = Object.values(mongoose.models)
      .filter((m) => m.schema.path("userId"))
      .map((m) => m.collection.collectionName);
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(BACKUP_COLLECTIONS as readonly string[]).toContain(n);
  });
});

// -------------------------------------------------------------------------------- attachments

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("attachments", () => {
  afterEach(() => setStorageForTests(undefined));

  it("upload, list, owner-only download, follows an edit, delete removes the file", async () => {
    const store = memoryStorage();
    setStorageForTests(store);
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { openingBalanceMinor: 1_000_000 });
    const groceries = await categoryId(ctx, "Groceries");
    const txn = await post(ctx, {
      type: "expense",
      date: "2026-01-05",
      amountMinor: 10_000,
      fromAccountId: bank.id,
      categoryId: groceries,
    });
    const a = await uploadAttachment(ctx, {
      transactionId: txn,
      fileName: "../receipt <1>.png",
      mimeType: "image/png",
      bytes: PNG,
    });
    expect(a).toMatchObject({
      fileName: "receipt _1_.png",
      sizeBytes: PNG.length,
      url: `/api/files/${a.id}`,
    });
    expect(store.objects.size).toBe(1);
    expect((await readAttachment(ctx, a.id))!.bytes).toEqual(PNG);
    const other = await makeUser();
    expect(await readAttachment(other, a.id)).toBeNull();
    await expect(
      uploadAttachment(other, {
        transactionId: txn,
        fileName: "x.png",
        mimeType: "image/png",
        bytes: PNG,
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      uploadAttachment(ctx, {
        transactionId: txn,
        fileName: "x.pdf",
        mimeType: "application/pdf",
        bytes: PNG,
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      uploadAttachment(ctx, {
        transactionId: txn,
        fileName: "x.exe",
        mimeType: "application/x-msdownload",
        bytes: PNG,
      }),
    ).rejects.toThrow(/Only JPEG/);

    const { id: edited } = await updateTransaction(ctx, txn, {
      type: "expense",
      date: "2026-01-05",
      amountMinor: 12_000,
      fromAccountId: bank.id,
      categoryId: groceries,
    });
    expect((await listAttachments(ctx, edited)).map((x) => x.id)).toEqual([a.id]);

    await deleteAttachment(ctx, a.id);
    expect(store.objects.size).toBe(0);
    expect(await listAttachments(ctx, edited)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------ reports

describe("reports", () => {
  it("realised gains, investment income, categories, net worth history, monthly review, CSV", async () => {
    const { ctx, bank } = await richUser();
    const fund = await makeHolding(ctx, {
      name: "Bond fund",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      openingDate: "2025-06-01",
    });
    await post(ctx, {
      type: "invest",
      date: "2025-07-02",
      amountMinor: 1_000_000,
      fromAccountId: bank.id,
      holdingId: fund.id,
    });
    await post(ctx, {
      type: "investment_income",
      date: "2025-10-01",
      amountMinor: 50_000,
      taxMinor: 2_500,
      incomeKind: "interest",
      toAccountId: bank.id,
      holdingId: fund.id,
      reinvest: false,
    });
    const realised = await getRealisedGains(ctx, 2025);
    expect(realised.lines).toHaveLength(1);
    expect(realised.lines[0]).toMatchObject({ holdingName: "Fund", amountMinor: 1_000_000 });
    expect((await getRealisedGains(ctx, 2024)).lines).toHaveLength(0);
    const income = await getInvestmentIncome(ctx, 2025);
    expect(income.totals).toEqual({
      grossMinor: 50_000,
      taxMinor: 2_500,
      netMinor: 47_500,
      reinvestedMinor: 0,
    });

    const cats = await getCategoriesReport(ctx, "2025-08", "2025-08");
    expect(cats.rows[0]).toMatchObject({ name: "Food & Dining", amountMinor: 300_000 });
    expect(cats.rows[0]!.children[0]).toMatchObject({ name: "Groceries" });

    const history = await getNetWorthHistory(ctx);
    expect(history.rows[0]!.month).toBe("2025-06");
    expect(history.rows.at(-1)!.date).toBe(today());

    // Monthly review: generated once for last month, then served from the store.
    expect(await ensureMonthlyReview(ctx)).toBe(true);
    expect(await ensureMonthlyReview(ctx)).toBe(false);
    const last = shiftMonth(today().slice(0, 7), -1);
    expect(await MonthlyReviewModel.countDocuments({ userId: uid(ctx) })).toBe(1);
    const s = await getMonthlySummary(ctx, last);
    expect(s.generatedAt).not.toBeNull();
    const aug = await getMonthlySummary(ctx, "2025-08");
    expect(aug.generatedAt).toBeNull();
    expect(aug.review).toMatchObject({
      expenseMinor: 300_000,
      topCategories: [{ name: "Food & Dining" }],
    });

    const csv = await reportCsv(ctx, "realised", { year: "2025" });
    expect(csv.fileName).toBe("realised-gains-2025.csv");
    expect(csv.csv.split("\r\n")[1]).toMatch(/^2025-09-01,Fund,10000\.00,/);
    for (const r of [
      "monthly",
      "income-expense",
      "categories",
      "performance",
      "income",
      "net-worth",
    ]) {
      expect((await reportCsv(ctx, r, {})).csv.length).toBeGreaterThan(10);
    }
    await expect(reportCsv(ctx, "nope", {})).rejects.toThrow(/Unknown report/);
  });

  it("transactions CSV keeps the filters and guards formulas", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 1_000_000 });
    await post(ctx, {
      type: "expense",
      date: "2026-01-05",
      amountMinor: 12_345,
      fromAccountId: bank.id,
      categoryId: await categoryId(ctx, "Groceries"),
      description: "=cmd|' /C calc'!A0",
    });
    const all = await exportTransactionsCsv(ctx, transactionFiltersSchema.parse({ preset: "all" }));
    const lines = all.csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Date,Type,Status,Amount,Currency/);
    expect(all.rows).toBe(1);
    expect(lines.find((l) => l.includes("expense"))).toContain(",123.45,LKR,Bank,");
    expect(all.csv).toContain("'=cmd|");
    const onlyExpense = await exportTransactionsCsv(
      ctx,
      transactionFiltersSchema.parse({ preset: "all", types: "expense" }),
    );
    expect(onlyExpense.rows).toBe(1);
  });
});
