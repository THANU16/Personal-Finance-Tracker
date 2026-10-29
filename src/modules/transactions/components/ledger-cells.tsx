import { format, parse } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import type { TransactionDTO } from "@/modules/transactions/schemas";
import {
  TransactionAmount,
  categoryLabel,
  holdingTxnTitle,
} from "@/modules/transactions/components/transaction-amount";

// Cells shared by the desktop ledger table and the phone day list.

export const shortDate = (key: string) =>
  format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

export interface LedgerRow {
  txn: TransactionDTO;
  /** Account view: effect on this account and the balance after it. */
  deltaMinor?: number;
  balanceMinor?: number;
  currency?: string;
}

export function Title({ txn }: { txn: TransactionDTO }) {
  const title = txn.description ?? txn.counterparty ?? holdingTxnTitle(txn) ?? categoryLabel(txn);
  return (
    <div className="min-w-0">
      <div className={cn("truncate font-medium", txn.status === "void" && "line-through")}>
        {title}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {txn.description && txn.counterparty ? <span>{txn.counterparty} ·</span> : null}
        {txn.status === "void" ? (
          <Badge variant="secondary">Void{txn.voidReason ? ` · ${txn.voidReason}` : ""}</Badge>
        ) : null}
        {txn.source === "reconcile" ? <Badge variant="outline">Reconcile</Badge> : null}
        {txn.fromBucket ? (
          <Badge variant="outline">
            From {txn.fromBucket === "emergency" ? "emergency" : "opportunity"}
          </Badge>
        ) : null}
        {txn.toBucket ? (
          <Badge variant="outline">
            To {txn.toBucket === "emergency" ? "emergency" : "opportunity"}
          </Badge>
        ) : null}
        {txn.tags.map((t) => (
          <Badge key={t} variant="outline">
            #{t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function LedgerAmount({ row }: { row: LedgerRow }) {
  if (row.deltaMinor === undefined) return <TransactionAmount txn={row.txn} />;
  if (row.txn.type === "debt_payment" && row.deltaMinor > 0) {
    // Loan account (owner request): show what was paid; only the principal part reduces the loan,
    // which is what the running balance moves by.
    const ccy = row.currency ?? row.txn.currency;
    return (
      <span className="inline-flex flex-col items-end">
        <Money valueMinor={row.txn.amountMinor} currency={ccy} />
        <span className="text-xs text-muted-foreground">
          Loan reduced by <Money valueMinor={row.deltaMinor} currency={ccy} />
        </span>
      </span>
    );
  }
  return (
    <Money
      valueMinor={row.deltaMinor}
      currency={row.currency ?? row.txn.currency}
      signed={row.deltaMinor > 0}
    />
  );
}
