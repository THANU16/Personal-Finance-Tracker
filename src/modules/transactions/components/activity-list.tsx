"use client";

import * as React from "react";
import { format, parse } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { cashflowTone, dayCashflow, groupByDay } from "@/lib/day-groups";
import { cn } from "@/lib/utils";
import { Title, type LedgerRow } from "@/modules/transactions/components/ledger-cells";
import {
  TransactionAmount,
  accountsLabel,
  categoryLabel,
} from "@/modules/transactions/components/transaction-amount";
import { TransactionDetail } from "@/modules/transactions/components/transaction-day-list";
import { TransactionRowActions } from "@/modules/transactions/components/transaction-row-actions";
import { TONE } from "@/modules/transactions/components/tones";
import type { TransactionDTO } from "@/modules/transactions/schemas";

// Transactions page (owner request, 2026-11-05): day by day like the owner's reference app — a day
// header with the date, weekday and that day's income (blue) and expense (red); rows with category,
// description + account and the amount in the same colours. Phones: a list with a detail sheet per
// row; md+: one table grouped by day. Account pages and holding tabs keep TransactionsTable.

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date(2000, 0, 1));

function Amount({ txn }: { txn: TransactionDTO }) {
  return (
    <span className={cn("tabular-nums", TONE[cashflowTone(txn)])}>
      <TransactionAmount txn={txn} colorNegative={false} />
    </span>
  );
}

function DayHeading({ day }: { day: string }) {
  const d = parseKey(day);
  return (
    <span className="flex items-center gap-2">
      <span className="text-2xl leading-none font-semibold tabular-nums">{format(d, "dd")}</span>
      <span className="rounded bg-muted-foreground px-1.5 py-0.5 text-xs font-medium text-background">
        {format(d, "EEE")}
      </span>
      <span className="text-xs text-muted-foreground">{format(d, "MMM yyyy")}</span>
    </span>
  );
}

function DayTotals({ rows, currency }: { rows: LedgerRow[]; currency: string }) {
  const t = dayCashflow(
    rows.map((r) => r.txn),
    currency,
  );
  return (
    <span className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-0.5 text-sm tabular-nums">
      <span className={TONE.income}>
        <span className="sr-only">Income </span>
        <Money valueMinor={t.incomeMinor} currency={currency} />
      </span>
      <span className={TONE.expense}>
        <span className="sr-only">Expense </span>
        <Money valueMinor={t.expenseMinor} currency={currency} colorNegative={false} />
      </span>
      {t.partial ? (
        <Badge variant="outline" title="Other currencies not added">
          + other currencies
        </Badge>
      ) : null}
    </span>
  );
}

function PhoneRow({ row }: { row: LedgerRow }) {
  const [open, setOpen] = React.useState(false);
  const t = row.txn;
  return (
    <li className={cn(t.status === "void" && "opacity-60")}>
      <Dialog open={open} onOpenChange={setOpen}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="grid min-h-14 w-full grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left active:bg-muted"
        >
          <span className="line-clamp-2 text-sm break-words text-muted-foreground">
            {categoryLabel(t)}
          </span>
          <span className="min-w-0">
            <Title txn={t} />
            <span className="block truncate text-xs text-muted-foreground">{accountsLabel(t)}</span>
          </span>
          <span className="text-right text-sm font-medium">
            <Amount txn={t} />
          </span>
        </button>
        {open ? (
          <DialogContent>
            <TransactionDetail row={row} onClose={() => setOpen(false)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </li>
  );
}

export function ActivityList({ rows, currency }: { rows: LedgerRow[]; currency: string }) {
  const groups = groupByDay(
    rows,
    (r) => r.txn.date,
    () => 0,
  );
  return (
    <>
      {/* md+: one table, a header row per day (the filter bar above is unchanged). */}
      <div className="hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((g) => (
            <TableBody key={g.day} aria-label={format(parseKey(g.day), "EEEE d MMMM yyyy")}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={5} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <DayHeading day={g.day} />
                    <DayTotals rows={g.rows} currency={currency} />
                  </div>
                </TableCell>
              </TableRow>
              {g.rows.map((row) => (
                <TableRow
                  key={row.txn.id}
                  className={cn(row.txn.status === "void" && "opacity-60")}
                >
                  <TableCell className="max-w-56 truncate text-muted-foreground">
                    {categoryLabel(row.txn)}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <Title txn={row.txn} />
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">
                    {accountsLabel(row.txn)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount txn={row.txn} />
                  </TableCell>
                  <TableCell>
                    <TransactionRowActions txn={row.txn} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      </div>

      {/* Phones: the same days as sections with a sticky header. */}
      <div className="-mx-4 md:hidden">
        {groups.map((g) => (
          <section key={g.day} aria-label={format(parseKey(g.day), "EEEE d MMMM yyyy")}>
            <h3 className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 flex items-center justify-between gap-3 border-y bg-background/95 px-4 py-2 font-normal backdrop-blur">
              <DayHeading day={g.day} />
              <DayTotals rows={g.rows} currency={currency} />
            </h3>
            <ul className="divide-y">
              {g.rows.map((row) => (
                <PhoneRow key={row.txn.id} row={row} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
