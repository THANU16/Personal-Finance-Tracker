"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, MoreHorizontal, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, dataTableColumns } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { vizColor } from "@/lib/viz-palette";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { INSTRUMENT_LABEL } from "@/modules/holdings/components/holding-meta";
import { ValuationDialog } from "@/modules/holdings/components/valuation-dialog";
import type { PortfolioHolding } from "@/modules/holdings/queries";
import { useQuickAdd } from "@/modules/transactions/components/quick-add-context";

export function GainCell({
  minor,
  bp,
  currency,
}: {
  minor: number;
  bp: number | null;
  currency: string;
}) {
  return (
    <span className="flex flex-col items-end">
      <Money valueMinor={minor} currency={currency} signed={minor > 0} />
      {bp !== null ? (
        <span
          className={cn(
            "text-xs",
            bp < 0
              ? "text-destructive"
              : bp > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground",
          )}
        >
          {bp > 0 ? "▲ " : bp < 0 ? "▼ " : ""}
          {formatPercentBp(bp, { signed: true })}
        </span>
      ) : null}
    </span>
  );
}

export function StaleBadge({ days }: { days: number | null }) {
  return (
    <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
      Stale{days !== null ? ` · ${days}d` : ""}
    </Badge>
  );
}

/** Row quick actions: Buy · Redeem · Update value (docs/05 §5). */
export function HoldingQuickActions({
  holding,
  todayKey,
  bigChangeThresholdBp,
}: {
  holding: PortfolioHolding;
  todayKey: string;
  bigChangeThresholdBp: number;
}) {
  const { open } = useQuickAdd();
  const [valuing, setValuing] = React.useState(false);
  if (holding.status !== "active") return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={`Actions for ${holding.name}`} />}
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => open({ mode: "create", type: "invest", holdingId: holding.id })}
          >
            <ArrowDownToLine aria-hidden /> Buy
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => open({ mode: "create", type: "redeem", holdingId: holding.id })}
          >
            <ArrowUpFromLine aria-hidden /> Redeem
          </DropdownMenuItem>
          {!holding.fd ? (
            <DropdownMenuItem onClick={() => setValuing(true)}>
              <RefreshCw aria-hidden /> Update value
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ValuationDialog
        holding={holding}
        open={valuing}
        onOpenChange={setValuing}
        todayKey={todayKey}
        bigChangeThresholdBp={bigChangeThresholdBp}
      />
    </>
  );
}

const col = dataTableColumns<PortfolioHolding>();

/** Holdings table (sortable; stacked cards on phones). */
export function HoldingsTable({
  holdings,
  todayKey,
  bigChangeThresholdBp,
  showClass = false,
}: {
  holdings: PortfolioHolding[];
  todayKey: string;
  bigChangeThresholdBp: number;
  showClass?: boolean;
}) {
  const columns = React.useMemo(
    () => [
      col.accessor("name", {
        header: "Holding",
        cell: ({ row }) => {
          const h = row.original;
          return (
            <div className="min-w-0">
              <Link
                href={`/assets/${h.id}`}
                className="font-medium hover:underline focus-visible:underline"
              >
                {h.name}
              </Link>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {showClass ? (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: vizColor(h.assetClass.color) }}
                      aria-hidden
                    />
                    {h.assetClass.name} ·
                  </span>
                ) : null}
                {INSTRUMENT_LABEL[h.instrumentType]}
                {h.platform ? ` · ${h.platform}` : ""}
                {h.status === "closed" ? <Badge variant="secondary">Closed</Badge> : null}
                {h.countsTowardEmergencyFund ? (
                  <Badge variant="outline">Emergency fund</Badge>
                ) : null}
                {h.reserved?.emergencyMinor ? (
                  <Badge variant="outline">
                    Emergency{" "}
                    <Money valueMinor={h.reserved.emergencyMinor} currency={h.currency} compact />
                  </Badge>
                ) : null}
                {h.reserved?.opportunityMinor ? (
                  <Badge variant="outline">
                    Opportunity{" "}
                    <Money valueMinor={h.reserved.opportunityMinor} currency={h.currency} compact />
                  </Badge>
                ) : null}
              </div>
            </div>
          );
        },
      }),
      col.accessor("investedMinor", {
        header: "Invested",
        cell: ({ row }) => (
          <Money valueMinor={row.original.investedMinor} currency={row.original.currency} />
        ),
      }),
      col.accessor("currentValueMinor", {
        header: "Value",
        cell: ({ row }) => (
          <Money
            valueMinor={row.original.currentValueMinor}
            currency={row.original.currency}
            className="font-medium"
          />
        ),
      }),
      col.accessor("unrealizedGainMinor", {
        header: "Gain",
        cell: ({ row }) => (
          <GainCell
            minor={row.original.unrealizedGainMinor}
            bp={row.original.unrealizedBp}
            currency={row.original.currency}
          />
        ),
      }),
      col.accessor((h) => h.weightBp ?? -1, {
        id: "weight",
        header: "Weight",
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {row.original.weightBp !== null ? formatPercentBp(row.original.weightBp) : "—"}
          </span>
        ),
      }),
      col.accessor((h) => h.xirrBp ?? Number.NEGATIVE_INFINITY, {
        id: "xirr",
        header: "XIRR",
        cell: ({ row }) => (
          <span
            className="tabular-nums"
            title={row.original.xirrBp === null ? "Shown after 90 days" : undefined}
          >
            {row.original.xirrBp !== null ? formatPercentBp(row.original.xirrBp) : "—"}
          </span>
        ),
      }),
      col.accessor((h) => h.lastValuedAt ?? "", {
        id: "updated",
        header: "Updated",
        cell: ({ row }) => {
          const h = row.original;
          if (h.fd) return <span className="text-xs text-muted-foreground">Calculated</span>;
          return h.stale ? (
            <StaleBadge days={h.daysSinceValued} />
          ) : (
            <span className="text-xs text-muted-foreground">
              {h.daysSinceValued === 0 ? "Today" : `${h.daysSinceValued}d ago`}
            </span>
          );
        },
      }),
      col.display({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <HoldingQuickActions
            holding={row.original}
            todayKey={todayKey}
            bigChangeThresholdBp={bigChangeThresholdBp}
          />
        ),
      }),
    ],
    [showClass, todayKey, bigChangeThresholdBp],
  );
  return <DataTable columns={columns} data={holdings} getRowId={(h) => h.id} />;
}
