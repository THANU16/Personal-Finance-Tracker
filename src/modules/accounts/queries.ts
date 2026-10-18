import "server-only";
import { ACCOUNT_GROUPS } from "@/domain/accounts";
import { utcToBusinessDate } from "@/domain/dates";
import { runningBalances } from "@/domain/ledger";
import type { ToBase } from "@/domain/fx";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { loadToBase } from "@/modules/fx/service";
import type { AccountDTO } from "@/modules/accounts/schemas";
import { listAccounts, toAccountDTO } from "@/modules/accounts/service";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import { loadRefMaps, toTransactionDTO } from "@/modules/transactions/queries";
import type { TransactionDTO } from "@/modules/transactions/schemas";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { AppError } from "@/server/errors";
import { toLedgerTxn } from "@/server/ledger/to-ledger-txn";

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
}

export interface AccountGroup {
  key: string;
  label: string;
  accounts: AccountDTO[];
  /** Group total in base currency at today's rates (docs/04 §14). */
  subtotal: CurrencyTotal;
  /** Accounts left out of the subtotal because no FX rate exists. */
  fxMissing: number;
}

function baseTotal(
  accounts: AccountDTO[],
  toBase: ToBase,
  base: string,
  todayKey: string,
): { subtotal: CurrencyTotal; fxMissing: number } {
  let total = 0;
  let fxMissing = 0;
  for (const a of accounts) {
    const v = toBase(a.balanceMinor, a.currency, todayKey);
    if (v === null) fxMissing += 1;
    else total += v;
  }
  return { subtotal: { currency: base, totalMinor: total }, fxMissing };
}

/** /accounts: accounts grouped by docs/05 §3 groups with per-currency subtotals. */
export async function getAccountsOverview(
  ctx: Ctx,
  opts: { includeArchived?: boolean } = {},
): Promise<{ groups: AccountGroup[]; archivedCount: number }> {
  const [all, toBase] = await Promise.all([
    listAccounts(ctx, { includeArchived: true }),
    loadToBase(ctx),
  ]);
  const todayKey = utcToBusinessDate(new Date(), ctx.tz);
  const visible = opts.includeArchived ? all : all.filter((a) => !a.archived);
  const groups = ACCOUNT_GROUPS.map((g) => {
    const accounts = visible.filter((a) => (g.types as readonly string[]).includes(a.type));
    return {
      key: g.key,
      label: g.label,
      accounts,
      ...baseTotal(
        accounts.filter((a) => !a.archived),
        toBase,
        ctx.baseCurrency,
        todayKey,
      ),
    };
  }).filter((g) => g.accounts.length > 0);
  return { groups, archivedCount: all.filter((a) => a.archived).length };
}

export interface AccountLedgerRow {
  txn: TransactionDTO;
  deltaMinor: number;
  balanceMinor: number;
}

export interface AccountDetail {
  account: AccountDTO;
  rows: AccountLedgerRow[];
  total: number;
  page: number;
  pageCount: number;
  /** End-of-day balance at the opening date, each day with activity, and today. */
  history: { date: string; balanceMinor: number }[];
}

export const ACCOUNT_PAGE_SIZE = 50;

/** /accounts/[id]: running balance over posted transactions, newest first, plus history. */
export async function getAccountDetail(ctx: Ctx, id: string, page = 1): Promise<AccountDetail> {
  await connectDb();
  const userId = toObjectId(ctx.userId, "User");
  const accountId = toObjectId(id, "Account");
  const doc = await AccountModel.findOne({ _id: accountId, userId }).lean<AccountDoc>();
  if (!doc) throw new AppError("NOT_FOUND", "Account not found");

  const [txns, refs] = await Promise.all([
    TransactionModel.find({
      userId,
      status: "posted",
      $or: [{ fromAccountId: accountId }, { toAccountId: accountId }],
    })
      .sort({ date: 1, createdAt: 1 })
      .lean<TransactionDoc[]>(),
    loadRefMaps(userId),
  ]);

  const running = runningBalances(doc.openingBalanceMinor, txns.map(toLedgerTxn), id);
  const today = utcToBusinessDate(new Date(), ctx.tz);

  const byDay = new Map<string, number>();
  byDay.set(utcToBusinessDate(doc.openingDate, ctx.tz), doc.openingBalanceMinor);
  running.forEach((r, i) => byDay.set(utcToBusinessDate(txns[i]!.date, ctx.tz), r.balanceMinor));
  const last = running.at(-1)?.balanceMinor ?? doc.openingBalanceMinor;
  if (!byDay.has(today) && [...byDay.keys()].every((d) => d < today)) byDay.set(today, last);
  const history = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, balanceMinor]) => ({ date, balanceMinor }));

  const rowsNewestFirst = running
    .map((r, i) => ({ doc: txns[i]!, deltaMinor: r.deltaMinor, balanceMinor: r.balanceMinor }))
    .reverse();
  const pageCount = Math.max(1, Math.ceil(rowsNewestFirst.length / ACCOUNT_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rows = rowsNewestFirst
    .slice((safePage - 1) * ACCOUNT_PAGE_SIZE, safePage * ACCOUNT_PAGE_SIZE)
    .map((r) => ({
      txn: toTransactionDTO(r.doc, refs, ctx.tz),
      deltaMinor: r.deltaMinor,
      balanceMinor: r.balanceMinor,
    }));

  return {
    account: toAccountDTO(doc, ctx.tz, today),
    rows,
    total: running.length,
    page: safePage,
    pageCount,
    history,
  };
}
