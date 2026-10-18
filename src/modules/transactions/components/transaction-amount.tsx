import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Scale, type LucideIcon } from "lucide-react";
import { Money } from "@/components/shared/money";
import type { TransactionType } from "@/domain/ledger";
import type { TransactionDTO } from "@/modules/transactions/schemas";

export const TYPE_META: Partial<Record<TransactionType, { label: string; icon: LucideIcon }>> = {
  income: { label: "Income", icon: ArrowDownLeft },
  expense: { label: "Expense", icon: ArrowUpRight },
  transfer: { label: "Transfer", icon: ArrowLeftRight },
  adjustment: { label: "Adjustment", icon: Scale },
};

/** Signed for the ledger view: income +, expense −, adjustment by direction, transfer unsigned. */
export function signedAmount(t: TransactionDTO): number {
  if (t.type === "expense") return -t.amountMinor;
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
      </span>
    );
  }
  const signed = signedAmount(txn);
  return <Money valueMinor={signed} currency={txn.currency} signed={signed > 0} />;
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

/** "Groceries", "Split · 2 categories", "Sampath → HNB Visa", … */
export function categoryLabel(t: TransactionDTO): string {
  if (t.type === "transfer") return "Transfer";
  if (t.splits.length) return `Split · ${t.splits.map((s) => s.category.name).join(", ")}`;
  return t.category?.name ?? "Uncategorised";
}

export function accountsLabel(t: TransactionDTO): string {
  if (t.type === "transfer") return `${t.fromAccount?.name ?? "?"} → ${t.toAccount?.name ?? "?"}`;
  return (t.fromAccount ?? t.toAccount)?.name ?? "";
}
