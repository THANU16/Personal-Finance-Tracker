"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Amount, NoData } from "@/components/charts/chart-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercentBp } from "@/lib/format";
import { vizColor } from "@/lib/viz-palette";
import type { Allocation, TopCategories } from "@/modules/dashboard/queries";

// docs/07 §8 — Recharts loads after the page: each plot is a lazy chunk shown in a placeholder of
// the same height (legend row + plot), so nothing moves when it arrives. Lists render at once.

const S1 = "var(--viz-series-1)";

function framePlaceholder(height: string) {
  function ChartPlaceholder() {
    return (
      <div className="grid gap-2" aria-busy="true">
        <div className="h-5" />
        <Skeleton className={`w-full rounded-lg ${height}`} />
      </div>
    );
  }
  return ChartPlaceholder;
}

const load = () => import("@/components/charts/dashboard-charts");

export const NetWorthSparkline = dynamic(() => load().then((m) => m.NetWorthSparkline), {
  ssr: false,
  loading: () => <div className="h-14" aria-busy="true" />,
});
export const NetWorthChart = dynamic(() => load().then((m) => m.NetWorthChart), {
  ssr: false,
  loading: framePlaceholder("h-60"),
});
export const AssetsLiabilitiesChart = dynamic(() => load().then((m) => m.AssetsLiabilitiesChart), {
  ssr: false,
  loading: framePlaceholder("h-60"),
});
export const CashflowChart = dynamic(() => load().then((m) => m.CashflowChart), {
  ssr: false,
  loading: framePlaceholder("h-60"),
});
export const SavingsRateChart = dynamic(() => load().then((m) => m.SavingsRateChart), {
  ssr: false,
  loading: framePlaceholder("h-28"),
});

const AllocationPie = dynamic(
  () => import("@/components/charts/allocation-pie").then((m) => m.AllocationPie),
  { ssr: false },
);

// ------------------------------------------------------------------------------- allocation

/** Allocation donut by class (fixed class colours; 2px surface ring between slices). */
export function AllocationDonut({ allocation }: { allocation: Allocation }) {
  const [open, setOpen] = useState<string | null>(null);
  const { classes, currency } = allocation;
  if (classes.length === 0) {
    return <NoData>Add holdings to see your allocation.</NoData>;
  }
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[176px_1fr]">
      <figure
        aria-label={`Allocation by asset class: ${classes.map((c) => `${c.name} ${formatPercentBp(c.shareBp)}`).join(", ")}`}
        className="mx-auto size-44"
      >
        <AllocationPie classes={classes} currency={currency} />
      </figure>
      <ul className="grid gap-1 text-sm" aria-label="Asset classes">
        {classes.map((c) => (
          <li key={c.id}>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left hover:underline max-md:min-h-11"
                aria-expanded={open === c.id}
                onClick={() => setOpen((o) => (o === c.id ? null : c.id))}
              >
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: vizColor(c.color) }}
                  aria-hidden
                />
                <span className="truncate">{c.name}</span>
              </button>
              <span className="flex items-baseline gap-2 tabular-nums">
                <span className="text-xs text-muted-foreground">{formatPercentBp(c.shareBp)}</span>
                <Amount minor={c.valueMinor} currency={currency} />
              </span>
            </div>
            {open === c.id ? (
              <ul className="mt-1 mb-2 grid gap-0.5 border-l pl-4 text-xs text-muted-foreground">
                {c.holdings.map((h) => (
                  <li key={h.id} className="flex justify-between gap-3">
                    <Link href={`/assets/${h.id}`} className="truncate hover:underline">
                      {h.name}
                    </Link>
                    <span className="tabular-nums">
                      {formatPercentBp(h.shareBp)} ·{" "}
                      <Amount minor={h.valueMinor} currency={currency} />
                    </span>
                  </li>
                ))}
                <li>
                  <Link href={`/assets?class=${c.id}`} className="underline underline-offset-4">
                    Open in Assets
                  </Link>
                </li>
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- top categories

/** Top expense categories — direct-labelled bars; each opens Transactions with the same range. */
export function TopCategoriesList({
  data,
  from,
  to,
}: {
  data: TopCategories;
  from: string;
  to: string;
}) {
  if (data.categories.length === 0) return <NoData>No expenses in this range.</NoData>;
  const max = Math.max(...data.categories.map((c) => c.valueMinor));
  const href = (id: string) =>
    id === "uncategorised"
      ? `/transactions?preset=custom&from=${from}&to=${to}&types=expense`
      : `/transactions?preset=custom&from=${from}&to=${to}&category=${id}`;
  return (
    <ul className="grid gap-2.5" aria-label="Top expense categories">
      {data.categories.map((c) => (
        <li key={c.id}>
          <Link
            href={href(c.id)}
            className="group grid gap-1 max-md:min-h-11 max-md:content-center"
          >
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate group-hover:underline">{c.name}</span>
              <span className="tabular-nums">
                <span className="mr-2 text-xs text-muted-foreground">
                  {formatPercentBp(c.shareBp)}
                </span>
                <Amount minor={c.valueMinor} currency={data.currency} />
              </span>
            </span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{ width: `${(c.valueMinor / max) * 100}%`, background: S1 }}
              />
            </span>
          </Link>
        </li>
      ))}
      {data.otherMinor > 0 ? (
        <li className="flex justify-between text-xs text-muted-foreground">
          <span>Everything else</span>
          <Amount minor={data.otherMinor} currency={data.currency} />
        </li>
      ) : null}
    </ul>
  );
}
