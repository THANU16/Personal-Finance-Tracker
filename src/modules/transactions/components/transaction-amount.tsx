import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Coins,
  Flag,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { Money } from "@/components/shared/money";
import type { TransactionType } from "@/domain/ledger";
import type { TransactionDTO } from "@/modules/transactions/schemas";

export const TYPE_META: Partial<Record<TransactionType, { label: string; icon: LucideIcon }>> = {
  income: { label: "Income", icon: ArrowDownLeft },
  expense: { label: "Expense", icon: ArrowUpRight },
  transfer: { label: "Transfer", icon: ArrowLeftRight },
  adjustment: { label: "Adjustment", icon: Scale },
  invest: { label: "Buy", icon: ArrowDownToLine },
  redeem: { label: "Redeem", icon: ArrowUpFromLine },
  investment_income: { label: "Investment income", icon: Coins },
  opening_balance: { label: "Opening balance", icon: Flag },
};

const INCOME_KIND_LABEL = {
  dividend: "Dividend",
  interest: "Interest",
  distribution: "Distribution",
  rent: "Rent",
  other: "Income",
} as const;

/**
 * Signed for the ledger list (cash point of view): income/redeem/paid-out investment income +,
 * expense/buy −, adjustment by direction; transfers, opening balances and reinvested income unsigned.
 */
export function signedAmount(t: TransactionDTO): number {
  if (t.type === "expense") return -t.amountMinor;
  if (t.type === "invest") return -(t.amountMinor + t.feeMinor);
  if (t.type === "redeem") return t.amountMinor - t.feeMinor - t.taxMinor;
  if (t.type === "investment_income") return t.reinvest ? 0 : t.amountMinor - t.taxMinor;
  if (t.type === "adjustment" && t.fromAccount) return -t.amountMinor;
  return t.amountMinor;
}

export function TransactionAmount({ txn }: { txn: TransactionDTO }) {
  if (txn.type === "transfer") {
    return (
      <span className="flex flex-col items-end">
        <Money valueMinor={txn.amountMinor} currency={txn.currency} colorNegative={false} />
        {txn.toAmountMinor && txn.toAccount ? (
          <span className="text-xs text-muted-foreground">
            → <Money valueMinor={txn.toAmountMinor} currency={txn.toAccount.currency} />
          </span>
        ) : null}
        {txn.feeMinor > 0 ? (
          <span className="text-xs text-muted-foreground">
            + fee <Money valueMinor={txn.feeMinor} currency={txn.currency} />
          </span>
        ) : null}
      </span>
    );
  }
  if (txn.type === "opening_balance" || (txn.type === "investment_income" && txn.reinvest)) {
    return (
      <span className="flex flex-col items-end">
        <Money valueMinor={txn.amountMinor} currency={txn.currency} colorNegative={false} />
        <span className="text-xs text-muted-foreground">
          {txn.type === "opening_balance" ? "no cash moved" : "reinvested"}
        </span>
      </span>
    );
  }
  const signed = signedAmount(txn);
  const hasCharges =
    (txn.type === "invest" || txn.type === "redeem" || txn.type === "investment_income") &&
    (txn.feeMinor > 0 || txn.taxMinor > 0);
  return (
    <span className="flex flex-col items-end">
      <Money valueMinor={signed} currency={txn.currency} signed={signed > 0} />
      {hasCharges ? (
        <span className="text-xs text-muted-foreground">
          gross <Money valueMinor={txn.amountMinor} currency={txn.currency} />
        </span>
      ) : null}
    </span>
  );
}

export function TypeIcon({ type }: { type: TransactionType }) {
  const meta = TYPE_META[type];
  if (!meta) return null;
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      title={meta.label}
    >
      <meta.icon className="size-4" aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** "Groceries", "Split · …", "Transfer", "Buy · Ceylon Equity Fund", … */
export function categoryLabel(t: TransactionDTO): string {
  if (t.type === "transfer") return t.feeMinor > 0 ? "Transfer · Bank fees" : "Transfer";
  if (t.holding) return t.holding.name;
  if (t.splits.length) return `Split · ${t.splits.map((s) => s.category.name).join(", ")}`;
  return t.category?.name ?? "Uncategorised";
}

/** What happened, for holding transactions without a description ("Buy", "Dividend"). */
export function holdingTxnTitle(t: TransactionDTO): string | null {
  if (!t.holding) return null;
  if (t.type === "investment_income") return INCOME_KIND_LABEL[t.incomeKind ?? "other"];
  return TYPE_META[t.type]?.label ?? null;
}

export function accountsLabel(t: TransactionDTO): string {
  if (t.type === "transfer") return `${t.fromAccount?.name ?? "?"} → ${t.toAccount?.name ?? "?"}`;
  return (t.fromAccount ?? t.toAccount)?.name ?? "";
}
