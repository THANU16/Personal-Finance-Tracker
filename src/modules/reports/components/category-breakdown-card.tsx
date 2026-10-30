"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Amount, NoData, TooltipRow, TooltipShell } from "@/components/charts/chart-kit";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewCategory } from "@/domain/reports";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stackOnPhone } from "@/components/shared/mobile/stack-table";

// Monthly summary (owner request): every income / expense category, top 5 first, with a donut of
// the top 5 + "Other". Colours follow the fixed categorical order; the table is the legend.

const TOP = 5;
const OTHER = "var(--muted-foreground)";
const colorOf = (i: number) => (i < TOP ? `var(--viz-cat-${i + 1})` : OTHER);

/** "New" when there was nothing last month; very large jumps are capped so they stay readable. */
function changeText(c: ReviewCategory): string {
  if (c.previousMinor === 0 || c.changeBp === null) return "New";
  if (c.changeBp > 99_900) return ">+999%";
  return formatPercentBp(c.changeBp, { signed: true });
}

interface Slice {
  key: string;
  name: string;
  valueMinor: number;
  shareBp: number | null;
  color: string;
}

export function CategoryBreakdownCard({
  title,
  amountLabel,
  rows,
  currency,
  empty,
}: {
  title: string;
  /** Column header for the amount ("Spent" / "Received"). */
  amountLabel: string;
  rows: readonly ReviewCategory[];
  currency: string;
  empty: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const total = rows.reduce((s, c) => s + c.amountMinor, 0);
  const rest = rows.slice(TOP);
  const otherMinor = rest.reduce((s, c) => s + c.amountMinor, 0);
  const slices: Slice[] = [
    ...rows.slice(0, TOP).map((c, i) => ({
      key: c.categoryId,
      name: c.name,
      valueMinor: c.amountMinor,
      shareBp: c.shareBp,
      color: colorOf(i),
    })),
    ...(otherMinor > 0
      ? [
          {
            key: "other",
            name: `Other (${rest.length})`,
            valueMinor: otherMinor,
            shareBp: total > 0 ? Math.round((otherMinor * 10_000) / total) : null,
            color: OTHER,
          },
        ]
      : []),
  ];
  const visible = showAll ? rows : rows.slice(0, TOP);
  const TH = "px-3 py-2 font-medium";
  const NUM = "px-3 py-2 text-right tabular-nums";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {rows.length === 0 ? (
          <NoData>{empty}</NoData>
        ) : (
          <>
            <figure
              aria-label={`${title}: ${slices.map((s) => `${s.name} ${s.shareBp === null ? "" : formatPercentBp(s.shareBp)}`).join(", ")}`}
              className="relative mx-auto size-48"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="valueMinor"
                    nameKey="name"
                    innerRadius="70%"
                    outerRadius="100%"
                    stroke="var(--card)"
                    // 2px surface gap between slices; none for a single full ring (it would show a seam).
                    strokeWidth={slices.length > 1 ? 2 : 0}
                    isAnimationActive={false}
                  >
                    {slices.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      const s = active ? (payload?.[0]?.payload as Slice | undefined) : undefined;
                      if (!s) return null;
                      return (
                        <TooltipShell title={s.name}>
                          <TooltipRow
                            color={s.color}
                            label={s.shareBp === null ? "—" : formatPercentBp(s.shareBp)}
                            value={<Amount minor={s.valueMinor} currency={currency} />}
                          />
                        </TooltipShell>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <figcaption className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                <span className="text-xs text-muted-foreground">Total</span>
                <span className="max-w-32 text-xs font-semibold tabular-nums">
                  <Money valueMinor={total} currency={currency} />
                </span>
              </figcaption>
            </figure>
            <div className="overflow-x-auto rounded-lg border">
              <table className={cn("w-full text-sm", stackOnPhone)}>
                <caption className="sr-only">{title}</caption>
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className={cn(TH, "text-left")}>
                      Category
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      {amountLabel}
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      Share
                    </th>
                    <th scope="col" className={cn(TH, "text-right")}>
                      vs previous
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c, i) => (
                    <tr key={c.categoryId} className="border-t">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-sm"
                            style={{ background: colorOf(i) }}
                            aria-hidden
                          />
                          <span className="truncate">{c.name}</span>
                        </span>
                      </td>
                      <td className={NUM}>
                        <Money valueMinor={c.amountMinor} currency={currency} />
                      </td>
                      <td data-label="Share" className={cn(NUM, "text-muted-foreground")}>
                        {c.shareBp === null ? "—" : formatPercentBp(c.shareBp)}
                      </td>
                      <td data-label="vs previous" className={NUM}>
                        {changeText(c)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/50 font-medium">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className={NUM}>
                      <Money valueMinor={total} currency={currency} />
                    </td>
                    <td className={NUM} />
                    <td className={NUM} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {rows.length > TOP ? (
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show top 5" : `Show all ${rows.length} categories`}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
