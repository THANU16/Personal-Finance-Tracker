"use client";

import { useChartAxes } from "@/components/charts/chart-kit";
import { format, parse } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { formatMoney } from "@/lib/format";

export interface BalancePoint {
  date: string;
  balanceMinor: number;
}

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date(2000, 0, 1));

/** One tick per month start inside the range (thinned to ≤ 8), so labels never repeat. */
function monthTicks(min: number, max: number): number[] {
  const months: number[] = [];
  const d = new Date(min);
  let cursor = new Date(d.getFullYear(), d.getMonth() + (d.getDate() === 1 ? 0 : 1), 1);
  while (cursor.getTime() <= max) {
    months.push(cursor.getTime());
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  const step = Math.ceil(months.length / 8) || 1;
  return months.filter((_, i) => i % step === 0);
}

function ChartTooltip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const point = active ? (payload?.[0]?.payload as BalancePoint | undefined) : undefined;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div data-money="" className="text-sm font-semibold text-foreground tabular-nums">
        {formatMoney(point.balanceMinor, currency)}
      </div>
      <div className="text-muted-foreground">{format(parseKey(point.date), "d MMM yyyy")}</div>
    </div>
  );
}

/**
 * Single-series balance over time (dataviz: one series → slot-1 hue, no legend; 2px step line
 * with a ~10% wash; crosshair + tooltip; the transactions table below is the table view).
 * Step-after because a balance holds its value until the next transaction.
 */
export function BalanceHistoryChart({
  points,
  currency,
}: {
  points: BalancePoint[];
  currency: string;
}) {
  const ax = useChartAxes();
  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        The balance history appears once there is activity on more than one day.
      </p>
    );
  }
  const data = points.map((p) => ({ ...p, t: parseKey(p.date).getTime() }));
  const ticks = monthTicks(data[0]!.t, data.at(-1)!.t);

  return (
    <figure aria-label="Balance history" className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={(t: number) => format(t, "MMM yy")}
            tick={ax.axis.tick}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={32}
          />
          <YAxis
            dataKey="balanceMinor"
            tickFormatter={ax.money(currency)}
            tick={ax.axis.tick}
            tickLine={false}
            axisLine={false}
            width={ax.yWidth(88)}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(props) => <ChartTooltip {...props} currency={currency} />}
          />
          <Area
            type="stepAfter"
            dataKey="balanceMinor"
            stroke="var(--viz-series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="var(--viz-series-1)"
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: "var(--viz-series-1)" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
