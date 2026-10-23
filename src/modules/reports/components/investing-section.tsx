"use client";

import Link from "next/link";
import { useState } from "react";
import { NoData } from "@/components/charts/chart-kit";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyReview } from "@/domain/reports";
import { cn } from "@/lib/utils";

// Monthly summary → Investing (owner request): money in and out, investment income (paid out and
// reinvested), how the portfolio value moved, and each holding's month.

const TOP = 5;
const TH = "px-3 py-2 font-medium";
const NUM = "px-3 py-2 text-right tabular-nums";

function Line({
  label,
  children,
  strong,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
  sub?: boolean;
}) {
  return (
    <>
      <dt
        className={cn(
          "text-muted-foreground",
          sub && "pl-3 text-xs",
          strong && "font-medium text-foreground",
        )}
      >
        {label}
      </dt>
      <dd className={cn("text-right tabular-nums", sub && "text-xs", strong && "font-medium")}>
        {children}
      </dd>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

export function InvestingSection({ review: r }: { review: MonthlyReview }) {
  const [showAll, setShowAll] = useState(false);
  const ccy = r.currency;
  const inv = r.investing;
  const p = inv.portfolio;
  const m = (v: number, signed = false) => <Money valueMinor={v} currency={ccy} signed={signed} />;
  const rows = showAll ? inv.holdings : inv.holdings.slice(0, TOP);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Investing</CardTitle>
        <CardDescription>
          Reinvested income stays in the holding, so it is not part of Income or the savings rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Panel title="Money in & out">
            <Line label="Bought">{m(inv.boughtMinor)}</Line>
            <Line label="Sold">{m(inv.soldMinor)}</Line>
            <Line label="Net invested" strong>
              {m(inv.netInvestedMinor, true)}
            </Line>
            <Line label="Buy & sell fees">{m(inv.feesMinor)}</Line>
            <Line label="Realised gains">{m(r.realizedGainMinor, true)}</Line>
          </Panel>
          <Panel title="Investment income">
            <Line label="Received" strong>
              {m(inv.income.receivedMinor)}
            </Line>
            <Line label="Paid out to accounts" sub>
              {m(inv.income.paidOutMinor)}
            </Line>
            <Line label="Reinvested" sub>
              {m(inv.income.reinvestedMinor)}
            </Line>
            <Line label="Tax withheld">{m(inv.income.taxMinor)}</Line>
          </Panel>
          <Panel title="Portfolio value">
            <Line label="Start of month">{m(p.startMinor)}</Line>
            {p.addedMinor !== 0 ? (
              <Line label="+ New holdings (cost)">{m(p.addedMinor, true)}</Line>
            ) : null}
            <Line label="+ Net invested">{m(p.netInvestedMinor, true)}</Line>
            <Line label="+ Income reinvested">{m(p.reinvestedMinor, true)}</Line>
            <Line label="+ Market, interest & FX">{m(p.changeMinor, true)}</Line>
            <Line label="End of month" strong>
              {m(p.endMinor)}
            </Line>
          </Panel>
        </div>
        {inv.staleCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {inv.staleCount} holding{inv.staleCount === 1 ? " has" : "s have"} an old value, so
            {inv.staleCount === 1 ? " its" : " their"} market change shows as 0.{" "}
            <Link href="/assets" className="underline underline-offset-4">
              Update values
            </Link>
          </p>
        ) : null}

        {inv.holdings.length === 0 ? (
          <NoData>No investments this month.</NoData>
        ) : (
          <div className="grid gap-2">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">Investing by holding</caption>
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className={cn(TH, "text-left")}>
                      Holding
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Bought
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Sold
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Income
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Fees
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Value at month end
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.holdingId} className="border-t">
                      <td className="px-3 py-2">
                        <Link href={`/assets/${h.holdingId}`} className="hover:underline">
                          {h.name}
                        </Link>
                      </td>
                      <td className={NUM}>{m(h.boughtMinor)}</td>
                      <td className={NUM}>{m(h.soldMinor)}</td>
                      <td className={NUM}>{m(h.incomeMinor)}</td>
                      <td className={NUM}>{m(h.feesMinor)}</td>
                      <td className={NUM}>{m(h.endValueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {inv.holdings.length > TOP ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show top 5" : `Show all ${inv.holdings.length} holdings`}
              </Button>
            ) : null}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          SIPs: {r.sips.done} done · {r.sips.partial} partial · {r.sips.missed} missed ·{" "}
          {r.sips.skipped} skipped · invested {m(r.sips.investedMinor)}
        </p>
      </CardContent>
    </Card>
  );
}
