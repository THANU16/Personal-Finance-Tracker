// Posting effects of ledger transactions on account balances (docs/04 §1) and monthly cashflow
// (docs/04 §4). Pure: the ledger engine and tests both use these, so there is one definition.
import { add, divRound, sub } from "@/domain/money";

export const TRANSACTION_TYPES = [
  "income",
  "expense",
  "transfer",
  "invest",
  "redeem",
  "investment_income",
  "debt_payment",
  "adjustment",
  "opening_balance",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["posted", "void"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export interface SplitLine {
  categoryId: string;
  amountMinor: number;
}

/** The fields of a transaction that affect balances and cashflow. */
export interface LedgerTxn {
  type: TransactionType;
  status: TransactionStatus;
  amountMinor: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  toAmountMinor?: number | null;
  feeMinor?: number;
  taxMinor?: number;
  reinvest?: boolean | null;
  /** debt_payment: the loan account the principal reduces (derived from the debt). */
  loanAccountId?: string | null;
  principalMinor?: number | null;
  interestMinor?: number | null;
  categoryId?: string | null;
  splits?: SplitLine[] | null;
}

export interface AccountEffect {
  accountId: string;
  deltaMinor: number;
}

/** Balance changes a posted transaction makes (empty for void transactions). */
export function accountEffects(t: LedgerTxn): AccountEffect[] {
  if (t.status !== "posted") return [];
  const fee = t.feeMinor ?? 0;
  const tax = t.taxMinor ?? 0;
  const out: AccountEffect[] = [];
  const from = (delta: number) =>
    t.fromAccountId && out.push({ accountId: t.fromAccountId, deltaMinor: delta });
  const to = (delta: number) =>
    t.toAccountId && out.push({ accountId: t.toAccountId, deltaMinor: delta });

  switch (t.type) {
    case "income":
      to(t.amountMinor);
      break;
    case "expense":
      from(-t.amountMinor);
      break;
    case "transfer":
      from(-t.amountMinor);
      to(t.toAmountMinor ?? t.amountMinor);
      break;
    case "invest":
      from(-add(t.amountMinor, fee));
      break;
    case "redeem":
      to(sub(sub(t.amountMinor, fee), tax));
      break;
    case "investment_income":
      if (!t.reinvest) to(sub(t.amountMinor, tax));
      break;
    case "debt_payment":
      from(-t.amountMinor);
      if (t.loanAccountId)
        out.push({ accountId: t.loanAccountId, deltaMinor: t.principalMinor ?? 0 });
      break;
    case "adjustment":
      from(-t.amountMinor);
      to(t.amountMinor);
      break;
    case "opening_balance":
      break;
  }
  return out;
}

/** Net effect of one transaction on one account. */
export function effectOn(t: LedgerTxn, accountId: string): number {
  return accountEffects(t)
    .filter((e) => e.accountId === accountId)
    .reduce((sum, e) => add(sum, e.deltaMinor), 0);
}

/** `balance = openingBalanceMinor + Σ effect(t)` over posted transactions. */
export function computeBalance(
  openingMinor: number,
  txns: readonly LedgerTxn[],
  accountId: string,
): number {
  return txns.reduce((bal, t) => add(bal, effectOn(t, accountId)), openingMinor);
}

/** Balance after each transaction, in the given order (caller sorts by date, then creation). */
export function runningBalances<T extends LedgerTxn>(
  openingMinor: number,
  orderedTxns: readonly T[],
  accountId: string,
): { txn: T; deltaMinor: number; balanceMinor: number }[] {
  let balance = openingMinor;
  return orderedTxns.map((txn) => {
    const deltaMinor = effectOn(txn, accountId);
    balance = add(balance, deltaMinor);
    return { txn, deltaMinor, balanceMinor: balance };
  });
}

/** Reconcile: the adjustment that moves `balance` to the real balance (null if equal). */
export function reconcileAdjustment(
  balanceMinor: number,
  realBalanceMinor: number,
): { direction: "to" | "from"; amountMinor: number } | null {
  const diff = sub(realBalanceMinor, balanceMinor);
  if (diff === 0) return null;
  return diff > 0
    ? { direction: "to", amountMinor: diff }
    : { direction: "from", amountMinor: -diff };
}

export type SplitError =
  "too_few_lines" | "non_positive_line" | "sum_mismatch" | "duplicate_category";

/** Split lines must be ≥ 2, each > 0, distinct categories, and sum exactly to the amount. */
export function validateSplits(
  amountMinor: number,
  splits: readonly SplitLine[],
): SplitError | null {
  if (splits.length < 2) return "too_few_lines";
  if (splits.some((s) => !Number.isSafeInteger(s.amountMinor) || s.amountMinor <= 0)) {
    return "non_positive_line";
  }
  if (new Set(splits.map((s) => s.categoryId)).size !== splits.length) return "duplicate_category";
  return add(...splits.map((s) => s.amountMinor)) === amountMinor ? null : "sum_mismatch";
}

export interface CashflowSummary {
  incomeMinor: number;
  investmentIncomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
  /** Savings ÷ income in bp; null when income is 0. */
  savingsRateBp: number | null;
  /** Expense per category (splits counted per line; loan interest under its category id). */
  expenseByCategory: Map<string, number>;
}

/**
 * docs/04 §4. Income = income + investment income paid out; expense = expense (+ splits) +
 * interest part of debt payments. Excludes transfer, invest, redeem, principal, adjustment,
 * opening_balance and reinvested income. All txns must share one currency (caller converts).
 */
export function cashflowOf(
  txns: readonly LedgerTxn[],
  opts: { interestCategoryId?: string } = {},
): CashflowSummary {
  let income = 0;
  let investmentIncome = 0;
  let expense = 0;
  const byCategory = new Map<string, number>();
  const addCat = (id: string | null | undefined, amount: number) => {
    const key = id ?? "uncategorised";
    byCategory.set(key, add(byCategory.get(key) ?? 0, amount));
  };

  for (const t of txns) {
    if (t.status !== "posted") continue;
    switch (t.type) {
      case "income":
        income = add(income, t.amountMinor);
        break;
      case "investment_income":
        if (!t.reinvest) investmentIncome = add(investmentIncome, t.amountMinor);
        break;
      case "expense":
        expense = add(expense, t.amountMinor);
        if (t.splits && t.splits.length > 0)
          t.splits.forEach((s) => addCat(s.categoryId, s.amountMinor));
        else addCat(t.categoryId, t.amountMinor);
        break;
      case "debt_payment":
        if (t.interestMinor) {
          expense = add(expense, t.interestMinor);
          addCat(opts.interestCategoryId ?? t.categoryId, t.interestMinor);
        }
        break;
      default:
        break;
    }
  }
  const totalIncome = add(income, investmentIncome);
  const savings = sub(totalIncome, expense);
  return {
    incomeMinor: income,
    investmentIncomeMinor: investmentIncome,
    expenseMinor: expense,
    savingsMinor: savings,
    savingsRateBp: totalIncome === 0 ? null : divRound(savings * 10_000, totalIncome),
    expenseByCategory: byCategory,
  };
}
