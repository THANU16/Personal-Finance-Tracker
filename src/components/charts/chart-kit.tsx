"use client";

import { format, parse } from "date-fns";
import { useState, type ReactNode } from "react";
import type { Granularity } from "@/domain/date-range";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// Shared pieces for dashboard charts (dataviz skill): legend + table view on every chart, money in
// text tokens, compact axis ticks, horizontal scroll for many bars on small screens.

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date(2000, 0, 1));

/** Axis label for a bucket. */
export function bucketTick(start: string, g: Granularity): string {
  const d = parseKey(start);
  return g === "month" ? format(d, "MMM yy") : format(d, "d MMM");
}

/** Tooltip / table label for a bucket. */
export function bucketLabel(start: string, end: string, g: Granularity): string {
  const s = parseKey(start);
  if (g === "day") return format(s, "EEE d MMM yyyy");
  if (g === "month") return format(s, "MMMM yyyy");
  return `${format(s, "d MMM")} – ${format(parseKey(end), "d MMM yyyy")}`;
}

export const moneyTick = (currency: string) => (v: number) =>
  formatMoney(Math.round(v), currency, { compact: true });

export const AXIS = {
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
  tickLine: false,
} as const;

export interface LegendItem {
  label: string;
  color: string;
  /** line | bar swatch shape */
  shape?: "line" | "dash" | "box";
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {s.shape === "box" ? (
            <span
              className="inline-block size-2.5 rounded-sm"
              style={{ background: s.color }}
              aria-hidden
            />
          ) : (
            <span
              className="inline-block h-0 w-4 border-t-2"
              style={{ borderColor: s.color, borderStyle: s.shape === "dash" ? "dashed" : "solid" }}
              aria-hidden
            />
          )}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export interface TableColumn<T> {
  label: string;
  value: (row: T) => ReactNode;
  numeric?: boolean;
}

/**
 * Chart with a legend, an accessible summary and a "Table" toggle (dataviz: a table view always
 * exists, identity is never colour alone).
 */
export function ChartFrame<T>({
  label,
  summary,
  legend,
  rows,
  columns,
  minWidthPx,
  height = "h-60",
  children,
}: {
  label: string;
  summary: string;
  legend?: LegendItem[];
  rows: T[];
  columns: TableColumn<T>[];
  /** Above ~30 bars the plot scrolls horizontally on small screens. */
  minWidthPx?: number;
  height?: string;
  children: ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {legend ? <ChartLegend items={legend} /> : <span />}
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    className={cn(
                      "px-3 py-1.5 font-medium",
                      c.numeric ? "text-right" : "text-left",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => (
                    <td
                      key={c.label}
                      className={cn("px-3 py-1.5", c.numeric && "text-right tabular-nums")}
                    >
                      {c.value(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <figure
            aria-label={`${label}. ${summary}`}
            className={cn("w-full", height)}
            style={minWidthPx ? { minWidth: minWidthPx } : undefined}
          >
            {children}
          </figure>
        </div>
      )}
    </div>
  );
}

export function TooltipShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-48 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{title}</div>
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

export function TooltipRow({
  color,
  label,
  value,
  dashed,
}: {
  color?: string;
  label: string;
  value: ReactNode;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {color ? (
          <span
            className="inline-block h-0 w-3 border-t-2"
            style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
            aria-hidden
          />
        ) : null}
        {label}
      </span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export function Amount({
  minor,
  currency,
  signed,
}: {
  minor: number;
  currency: string;
  signed?: boolean;
}) {
  return <span data-money="">{formatMoney(minor, currency, { signed })}</span>;
}

/** "+LKR 1,200 (+3.4%) vs previous" — text tokens, never the series colour. */
export function DeltaText({
  delta,
  pctBp,
  currency,
  suffix = "vs previous",
}: {
  delta: number;
  pctBp: number | null;
  currency: string;
  suffix?: string;
}) {
  return (
    <span className="text-muted-foreground">
      <span data-money="">{formatMoney(delta, currency, { signed: true })}</span>
      {pctBp !== null ? ` (${pctBp >= 0 ? "+" : ""}${(pctBp / 100).toFixed(1)}%)` : ""} {suffix}
    </span>
  );
}

export function NoData({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
