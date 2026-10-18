"use client";

import { format, parse } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { ruleLevel, type OpportunityRule } from "@/domain/opportunity";
import { formatPercentBp } from "@/lib/format";

const parseKey = (key: string) => parse(key, "yyyy-MM-dd", new Date(2000, 0, 1));
const fmtLevel = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

// dataviz: one series (the benchmark) in slot 1; reference high and rule lines are recessive
// annotations in ink (dashed), labelled directly — never colour alone.
const LEVEL_COLOR = "var(--viz-series-1)";

function LevelTooltip({ active, payload, high }: TooltipContentProps & { high: number | null }) {
  const p = active
    ? (payload?.[0]?.payload as { date: string; level: number } | undefined)
    : undefined;
  if (!p) return null;
  const dd = high ? Math.max(0, Math.round(((high - p.level) / high) * 10_000)) : 0;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{format(parseKey(p.date), "d MMM yyyy")}</div>
      <div className="font-semibold text-foreground tabular-nums">{fmtLevel(p.level)}</div>
      {dd ? (
        <div className="text-muted-foreground">−{formatPercentBp(dd)} from the high</div>
      ) : null}
    </div>
  );
}

/** Benchmark levels with the reference high and each rule's trigger level (docs/05 §8). */
export function LevelsChart({
  levels,
  referenceHigh,
  rules,
  benchmarkName,
}: {
  levels: { date: string; level: number }[];
  referenceHigh: number | null;
  rules: OpportunityRule[];
  benchmarkName: string;
}) {
  if (levels.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Add at least two {benchmarkName} levels to see the chart.
      </p>
    );
  }
  const data = levels.map((l) => ({ ...l, t: parseKey(l.date).getTime() }));
  const lines = referenceHigh
    ? rules.map((r) => ({ rule: r, level: ruleLevel(referenceHigh, r) }))
    : [];
  const values = [...data.map((d) => d.level), ...lines.map((l) => l.level), referenceHigh ?? 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || max * 0.05;
  return (
    <figure
      aria-label={`${benchmarkName} levels with the reference high and rule levels`}
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => format(t, "d MMM yy")}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis
            domain={[Math.max(0, min - pad), max + pad]}
            tickFormatter={(v: number) => fmtLevel(Math.round(v))}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          {referenceHigh ? (
            <ReferenceLine
              y={referenceHigh}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 3"
              label={{
                value: "High",
                position: "right",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          ) : null}
          {lines.map((l) => (
            <ReferenceLine
              key={l.rule.drawdownBp}
              y={l.level}
              stroke="var(--border)"
              strokeDasharray="2 3"
              label={{
                value: `−${formatPercentBp(l.rule.drawdownBp)}`,
                position: "right",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          ))}
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(props) => <LevelTooltip {...props} high={referenceHigh} />}
          />
          <Line
            type="linear"
            dataKey="level"
            name={benchmarkName}
            stroke={LEVEL_COLOR}
            strokeWidth={2}
            dot={{ r: 3, fill: LEVEL_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: LEVEL_COLOR }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
