"use client";

import { format, parse } from "date-fns";
import { useId } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  type TooltipContentProps,
} from "recharts";
import {
  Amount,
  ChartFrame,
  NoData,
  TooltipRow,
  TooltipShell,
  useChartAxes,
} from "@/components/charts/chart-kit";
import type { InvestmentPoint } from "@/domain/investment-series";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatPercentBp } from "@/lib/format";
import { linePath, monotonePath, stepAfterPoints, type XY } from "@/lib/monotone-path";

// docs/04 §24 — invested (step) vs value (smooth curve, dots on values entered), gain shaded.
// dataviz: two series → validated series slots 1 and 2, legend always shown, values in ink.

const VALUE = "var(--viz-series-1)";
const INVESTED = "var(--viz-series-2)";
const GAIN_FILL = "color-mix(in oklab, var(--viz-cat-3) 18%, transparent)";
const LOSS_FILL = "color-mix(in oklab, var(--viz-cat-8) 18%, transparent)";
const DAY_MS = 86_400_000;

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date(2000, 0, 1));

interface Row extends InvestmentPoint {
  t: number;
}

/** Curve through the points; with `jumps`, a vertical step on each flow day (§24.8). */
function valuePoints(rows: readonly Row[], jumps: boolean): XY[][] {
  if (!jumps) return [rows.map((r) => [r.t, r.valueMinor] as const)];
  const segments: XY[][] = [[]];
  for (const r of rows) {
    if (r.before && segments.at(-1)!.length) {
      segments.at(-1)!.push([r.t, r.before.valueMinor]);
      segments.push([]);
    }
    segments.at(-1)!.push([r.t, r.valueMinor]);
  }
  return segments.filter((s) => s.length);
}

/** Drawn on the chart's own scales so the shading follows the value curve exactly. */
function InvestmentLayer({ rows, jumps }: { rows: readonly Row[]; jumps: boolean }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  const clipId = useId().replace(/:/g, "");
  if (!xScale || !yScale || rows.length === 0) return null;
  const px = ([t, v]: XY): XY => [Number(xScale(t)), Number(yScale(v))];

  const segments = valuePoints(rows, jumps).map((s) => s.map(px));
  const valueD = segments.map((s, i) => monotonePath(s, i > 0)).join("");
  const invested = stepAfterPoints(rows.map((r) => px([r.t, r.investedMinor])));
  const investedD = linePath(invested);
  const top = plot?.y ?? 0;
  const bottom = (plot?.y ?? 0) + (plot?.height ?? 0);
  const firstX = invested[0]![0];
  const lastX = invested.at(-1)![0];
  // Area between the curve and the step line; clipped above / below the step line.
  const between = `${valueD}${linePath([...invested].reverse(), true)}Z`;
  const edge = (y: number) => `${investedD}L${lastX},${y}L${firstX},${y}Z`;

  return (
    <g aria-hidden>
      <defs>
        <clipPath id={`gain-${clipId}`}>
          <path d={edge(top)} />
        </clipPath>
        <clipPath id={`loss-${clipId}`}>
          <path d={edge(bottom)} />
        </clipPath>
      </defs>
      <path d={between} fill={GAIN_FILL} clipPath={`url(#gain-${clipId})`} />
      <path d={between} fill={LOSS_FILL} clipPath={`url(#loss-${clipId})`} />
      <path d={investedD} fill="none" stroke={INVESTED} strokeWidth={2} strokeLinejoin="round" />
      <path
        d={valueD}
        fill="none"
        stroke={VALUE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {rows
        .filter((r) => r.entered)
        .map((r) => {
          const [x, y] = px([r.t, r.valueMinor]);
          return (
            <circle
              key={r.date}
              cx={x}
              cy={y}
              r={4}
              fill={VALUE}
              stroke="var(--card)"
              strokeWidth={2}
            />
          );
        })}
    </g>
  );
}

function ChartTip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const p = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
  if (!p) return null;
  const gain = p.valueMinor - p.investedMinor;
  const bp = p.investedMinor > 0 ? Math.round((gain * 10_000) / p.investedMinor) : null;
  return (
    <TooltipShell title={format(p.t, "d MMM yyyy")}>
      <TooltipRow
        color={VALUE}
        label="Value"
        value={<Amount minor={p.valueMinor} currency={currency} />}
      />
      <TooltipRow
        color={INVESTED}
        label="Invested"
        value={<Amount minor={p.investedMinor} currency={currency} />}
      />
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Gain</span>
        <span className="font-medium tabular-nums">
          <Amount minor={gain} currency={currency} signed />
          {bp !== null ? ` (${formatPercentBp(bp, { signed: true })})` : ""}
        </span>
      </div>
      <div className="text-muted-foreground">
        {p.entered ? "● Value you entered" : "Between your updates (estimated)"}
      </div>
    </TooltipShell>
  );
}

/** Nice y bounds covering every drawn value, including the day before each flow. */
function yBounds(rows: readonly Row[]): { lo: number; hi: number; ticks: number[] } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    for (const v of [
      r.valueMinor,
      r.investedMinor,
      r.before?.valueMinor,
      r.before?.investedMinor,
    ]) {
      if (v === undefined) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 100;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => raw <= k)!;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

function xTicks(from: number, to: number, count: number): number[] {
  if (to <= from) return [from];
  return Array.from({ length: count }, (_, i) =>
    Math.round(from + ((to - from) * i) / (count - 1)),
  );
}

export interface InvestmentChartProps {
  points: InvestmentPoint[];
  currency: string;
  /** Holding page: vertical jumps on flow days (§24.8). */
  jumps?: boolean;
  label: string;
}

export function InvestmentChart({ points, currency, jumps = false, label }: InvestmentChartProps) {
  const ax = useChartAxes();
  const isMobile = useIsMobile();
  const rows: Row[] = points
    .filter((p) => p.valueMinor !== 0 || p.investedMinor !== 0 || p.before)
    .map((p) => ({ ...p, t: parseKey(p.date).getTime() }));
  if (rows.length < 2) {
    return <NoData>The chart appears once this range has more than one day of activity.</NoData>;
  }
  const { lo, hi, ticks } = yBounds(rows);
  const first = rows[0]!.t;
  const last = rows.at(-1)!.t;
  const long = last - first > 400 * DAY_MS;
  const end = rows.at(-1)!;
  const gain = end.valueMinor - end.investedMinor;

  return (
    <ChartFrame
      label={label}
      summary={`Value ${end.valueMinor / 100} ${currency}, invested ${end.investedMinor / 100}, gain ${gain / 100} on ${end.date}.`}
      legend={[
        { label: "Value", color: VALUE },
        { label: "Invested", color: INVESTED },
        { label: "Gain", color: GAIN_FILL, shape: "box" },
      ]}
      rows={[...rows].reverse()}
      columns={[
        { label: "Date", value: (r) => format(r.t, "d MMM yyyy") },
        {
          label: "Invested",
          numeric: true,
          value: (r) => <Amount minor={r.investedMinor} currency={currency} />,
        },
        {
          label: "Value",
          numeric: true,
          value: (r) => <Amount minor={r.valueMinor} currency={currency} />,
        },
        {
          label: "Gain",
          numeric: true,
          value: (r) => (
            <Amount minor={r.valueMinor - r.investedMinor} currency={currency} signed />
          ),
        },
        { label: "Value source", value: (r) => (r.entered ? "Entered" : "Estimated") },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[first, last]}
            ticks={xTicks(first, last, isMobile ? 4 : 6)}
            tickFormatter={(t: number) => format(t, long ? "MMM yy" : "d MMM")}
            tick={ax.axis.tick}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            domain={[lo, hi]}
            ticks={ticks}
            allowDataOverflow
            tickFormatter={ax.money(currency)}
            tick={ax.axis.tick}
            tickLine={false}
            axisLine={false}
            width={ax.yWidth(88)}
          />
          <InvestmentLayer rows={rows} jumps={jumps} />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={(props) => <ChartTip {...props} currency={currency} />}
          />
          {/* Invisible series: they drive the tooltip and the hover dots; the layer draws the lines. */}
          <Line
            dataKey="investedMinor"
            stroke="transparent"
            dot={false}
            activeDot={{ r: 4, fill: INVESTED, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="valueMinor"
            stroke="transparent"
            dot={false}
            activeDot={{ r: 5, fill: VALUE, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
