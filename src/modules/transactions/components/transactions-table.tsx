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
import {
  LedgerAmount,
  Title,
  shortDate,
  type LedgerRow,
} from "@/modules/transactions/components/ledger-cells";
import {
  TypeIcon,
  accountsLabel,
  categoryLabel,
} from "@/modules/transactions/components/transaction-amount";
import { TransactionDayList } from "@/modules/transactions/components/transaction-day-list";
import { TransactionRowActions } from "@/modules/transactions/components/transaction-row-actions";

export type { LedgerRow };

/**
 * Ledger table; below md a day-grouped list with a detail sheet per row (docs/07 §5). Adds a
 * running balance in account view.
 */
export function TransactionsTable({
  rows,
  baseCurrency,
}: {
  rows: LedgerRow[];
  /** Phone day totals: income − expense in this currency (ledger view). */
  baseCurrency?: string;
}) {
  const running = rows.some((r) => r.balanceMinor !== undefined);
  return (
    <>
      <div className="hidden rounded-xl border md:block">
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
                  <LedgerAmount row={row} />
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

      <TransactionDayList rows={rows} baseCurrency={baseCurrency} />
    </>
  );
}
