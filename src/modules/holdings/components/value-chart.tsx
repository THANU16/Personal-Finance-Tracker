"use client";

import { format, parse } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { formatMoney } from "@/lib/format";

export interface ValuePoint {
  date: string;
  investedMinor: number;
  valueMinor: number;
}

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date(2000, 0, 1));

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

// dataviz: two series → categorical slots 1 and 2 (validated), legend always shown, values in ink.
const SERIES = [
  { key: "valueMinor", label: "Value", color: "var(--viz-series-1)" },
  { key: "investedMinor", label: "Invested", color: "var(--viz-series-2)" },
] as const;

function ChartTooltip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const p = active ? (payload?.[0]?.payload as ValuePoint | undefined) : undefined;
  if (!p) return null;
  return (
    <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{format(parseKey(p.date), "d MMM yyyy")}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ background: s.color }}
              aria-hidden
            />
            {s.label}
          </span>
          <span data-money="" className="font-semibold text-foreground tabular-nums">
            {formatMoney(p[s.key], currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Holding value vs invested over time (docs/05 §5). Step lines: values hold between events. */
export function ValueChart({ points, currency }: { points: ValuePoint[]; currency: string }) {
  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        The chart appears once there is activity on more than one day.
      </p>
    );
  }
  const data = points.map((p) => ({ ...p, t: parseKey(p.date).getTime() }));
  const ticks = monthTicks(data[0]!.t, data.at(-1)!.t);
  return (
    <div>
      <ul className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: s.color }}
              aria-hidden
            />
            {s.label}
          </li>
        ))}
      </ul>
      <figure aria-label="Value and invested over time" className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={(t: number) => format(t, "MMM yy")}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              tickFormatter={(v: number) => formatMoney(Math.round(v), currency, { compact: true })}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={88}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              content={(props) => <ChartTooltip {...props} currency={currency} />}
            />
            {[...SERIES].reverse().map((s) => (
              <Line
                key={s.key}
                type="stepAfter"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: s.color }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}
