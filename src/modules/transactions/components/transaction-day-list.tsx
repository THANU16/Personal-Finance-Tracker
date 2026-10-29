"use client";

import * as React from "react";
import { format, parse } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/shared/money";
import { cashflowSigned, groupByDay } from "@/lib/day-groups";
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
import { TransactionRowActions } from "@/modules/transactions/components/transaction-row-actions";

// docs/07 §5 Activity (phones): rows grouped by day with a day total; tap a row for the detail
// sheet with Edit / Duplicate / Attachments / Void. Desktop keeps the ledger table.

const dayLabel = (key: string) =>
  format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "EEE d MMM yyyy");

function Detail({ row, onClose }: { row: LedgerRow; onClose: () => void }) {
  const t = row.txn;
  const facts: [string, React.ReactNode][] = [
    ["Date", shortDate(t.date)],
    ["Category", categoryLabel(t)],
    ["Account", accountsLabel(t)],
  ];
  if (t.counterparty) facts.push([t.type === "income" ? "Payer" : "Payee", t.counterparty]);
  if (row.balanceMinor !== undefined) {
    facts.push([
      "Balance after",
      <Money key="b" valueMinor={row.balanceMinor} currency={row.currency ?? t.currency} />,
    ]);
  }
  if (t.notes) facts.push(["Notes", t.notes]);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="sr-only">Transaction</DialogTitle>
        <Title txn={t} />
        <DialogDescription className="sr-only">
          {shortDate(t.date)} · {categoryLabel(t)}
        </DialogDescription>
      </DialogHeader>
      <div className="text-2xl font-semibold tabular-nums">
        <LedgerAmount row={row} />
      </div>
      <dl className="-mx-4 divide-y border-y text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {t.status === "void" ? (
        <p className="text-sm text-muted-foreground">
          Voided{t.voidReason ? `: ${t.voidReason}` : ""}. It stays in the ledger.
        </p>
      ) : (
        <TransactionRowActions txn={t} layout="buttons" onAction={onClose} />
      )}
    </>
  );
}

function Row({ row }: { row: LedgerRow }) {
  const [open, setOpen] = React.useState(false);
  const t = row.txn;
  return (
    <li className={cn(t.status === "void" && "opacity-60")}>
      <Dialog open={open} onOpenChange={setOpen}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted"
        >
          <TypeIcon type={t.type} />
          <div className="min-w-0 flex-1">
            <Title txn={t} />
            <div className="truncate text-xs text-muted-foreground">
              {categoryLabel(t)} · {accountsLabel(t)}
            </div>
          </div>
          <div className="shrink-0 text-right text-sm font-medium tabular-nums">
            <LedgerAmount row={row} />
            {row.balanceMinor !== undefined ? (
              <div className="text-xs font-normal text-muted-foreground">
                <Money valueMinor={row.balanceMinor} currency={row.currency ?? t.currency} />
              </div>
            ) : null}
          </div>
        </button>
        {open ? (
          <DialogContent>
            <Detail row={row} onClose={() => setOpen(false)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </li>
  );
}

export function TransactionDayList({
  rows,
  baseCurrency,
}: {
  rows: LedgerRow[];
  /** Ledger view: day total = income − expense in this currency. */
  baseCurrency?: string;
}) {
  // Account view: the day total is the effect on this account; otherwise cashflow in base currency.
  const accountView = rows.some((r) => r.deltaMinor !== undefined);
  const currency = accountView ? (rows[0]?.currency ?? rows[0]?.txn.currency) : baseCurrency;
  const groups = groupByDay(
    rows,
    (r) => r.txn.date,
    (r) =>
      accountView
        ? r.txn.status === "void"
          ? 0
          : (r.deltaMinor ?? 0)
        : baseCurrency
          ? cashflowSigned(r.txn, baseCurrency)
          : 0,
  );
  return (
    <div className="-mx-4 md:hidden">
      {groups.map((g) => {
        const showTotal = Boolean(currency) && (g.totalMinor !== 0 || g.partial);
        return (
          <section key={g.day} aria-label={dayLabel(g.day)}>
            <h3 className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 flex items-baseline justify-between gap-3 border-b bg-background/95 px-4 py-2 text-sm font-medium backdrop-blur">
              <span>{dayLabel(g.day)}</span>
              {showTotal && currency ? (
                <span className="text-muted-foreground tabular-nums">
                  <Money
                    valueMinor={g.totalMinor}
                    currency={currency}
                    signed={g.totalMinor > 0}
                    colorNegative={false}
                  />
                  {g.partial ? (
                    <Badge variant="outline" className="ml-1.5" title="Other currencies not added">
                      + other currencies
                    </Badge>
                  ) : null}
                </span>
              ) : null}
            </h3>
            <ul className="divide-y">
              {g.rows.map((row) => (
                <Row key={row.txn.id} row={row} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
