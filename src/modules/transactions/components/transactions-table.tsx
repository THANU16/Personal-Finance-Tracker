import { format, parse } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import type { TransactionDTO } from "@/modules/transactions/schemas";
import {
  TransactionAmount,
  TypeIcon,
  accountsLabel,
  categoryLabel,
} from "@/modules/transactions/components/transaction-amount";
import { TransactionRowActions } from "@/modules/transactions/components/transaction-row-actions";

const shortDate = (key: string) =>
  format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

export interface LedgerRow {
  txn: TransactionDTO;
  /** Account view: effect on this account and the balance after it. */
  deltaMinor?: number;
  balanceMinor?: number;
  currency?: string;
}

function Title({ txn }: { txn: TransactionDTO }) {
  const title = txn.description ?? txn.counterparty ?? categoryLabel(txn);
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
        {txn.tags.map((t) => (
          <Badge key={t} variant="outline">
            #{t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function Amount({ row }: { row: LedgerRow }) {
  if (row.deltaMinor === undefined) return <TransactionAmount txn={row.txn} />;
  return (
    <Money
      valueMinor={row.deltaMinor}
      currency={row.currency ?? row.txn.currency}
      signed={row.deltaMinor > 0}
    />
  );
}

/** Ledger table; below 640px rows become stacked cards. Adds a running balance in account view. */
export function TransactionsTable({ rows }: { rows: LedgerRow[] }) {
  const running = rows.some((r) => r.balanceMinor !== undefined);
  return (
    <>
      <div className="hidden rounded-xl border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Type</span>
              </TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {running ? <TableHead className="text-right">Balance</TableHead> : null}
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.txn.id} className={cn(row.txn.status === "void" && "opacity-60")}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {shortDate(row.txn.date)}
                </TableCell>
                <TableCell>
                  <TypeIcon type={row.txn.type} />
                </TableCell>
                <TableCell className="max-w-64">
                  <Title txn={row.txn} />
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {categoryLabel(row.txn)}
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {accountsLabel(row.txn)}
                </TableCell>
                <TableCell className="text-right">
                  <Amount row={row} />
                </TableCell>
                {running ? (
                  <TableCell className="text-right">
                    {row.balanceMinor !== undefined ? (
                      <Money
                        valueMinor={row.balanceMinor}
                        currency={row.currency ?? row.txn.currency}
                      />
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell>
                  <TransactionRowActions txn={row.txn} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.txn.id}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3",
              row.txn.status === "void" && "opacity-60",
            )}
          >
            <TypeIcon type={row.txn.type} />
            <div className="min-w-0 flex-1">
              <Title txn={row.txn} />
              <div className="truncate text-xs text-muted-foreground">
                {shortDate(row.txn.date)} · {categoryLabel(row.txn)} · {accountsLabel(row.txn)}
              </div>
            </div>
            <div className="text-right text-sm">
              <Amount row={row} />
              {row.balanceMinor !== undefined ? (
                <div className="text-xs text-muted-foreground">
                  <Money
                    valueMinor={row.balanceMinor}
                    currency={row.currency ?? row.txn.currency}
                  />
                </div>
              ) : null}
            </div>
            <TransactionRowActions txn={row.txn} />
          </li>
        ))}
      </ul>
    </>
  );
}
