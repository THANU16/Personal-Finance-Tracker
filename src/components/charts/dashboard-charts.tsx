"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  Amount,
  ChartFrame,
  DeltaText,
  NoData,
  TooltipRow,
  TooltipShell,
  bucketLabel,
  bucketTick,
  useChartAxes,
} from "@/components/charts/chart-kit";
import type { Granularity } from "@/domain/date-range";
import { formatMoney, formatPercentBp } from "@/lib/format";
import { vizColor } from "@/lib/viz-palette";
import type {
  Allocation,
  CashflowBucket,
  NetWorthBucket,
  TopCategories,
} from "@/modules/dashboard/queries";

const S1 = "var(--viz-series-1)";
const S2 = "var(--viz-series-2)";
/** Previous period: neutral, dashed (never a categorical hue). */
const PREV = "var(--muted-foreground)";
const BAR_PX = 22;

const pct = (bp: number | null) => (bp === null ? "—" : formatPercentBp(bp));

// ------------------------------------------------------------------------------- net worth

type NwRow = NetWorthBucket & { prevBucket: number | null };

function NetWorthTip({
  active,
  payload,
  currency,
  g,
}: TooltipContentProps & { currency: string; g: Granularity }) {
  const p = active ? (payload?.[0]?.payload as NwRow | undefined) : undefined;
  if (!p) return null;
  return (
    <TooltipShell title={bucketLabel(p.start, p.end, g)}>
      <TooltipRow
        color={S1}
        label="Net worth"
        value={<Amount minor={p.netWorthMinor} currency={currency} />}
      />
      {p.prevBucket !== null ? (
        <DeltaText
          delta={p.netWorthMinor - p.prevBucket}
          pctBp={null}
          currency={currency}
          suffix="vs previous bucket"
        />
      ) : null}
      {p.previousNetWorthMinor !== null ? (
        <TooltipRow
          color={PREV}
          dashed
          label="Previous period"
          value={<Amount minor={p.previousNetWorthMinor} currency={currency} />}
        />
      ) : null}
    </TooltipShell>
  );
}

/** Net worth closing values per bucket (area), with the previous period dashed when comparing. */
/**
 * Mini net worth trend for the phone hero (docs/07 §5 Home): the same series as the trend chart,
 * no axes or tooltip; the full chart with its table view stays further down the page.
 */
export function NetWorthSparkline({ points, label }: { points: NetWorthBucket[]; label: string }) {
  if (points.length < 2) return null;
  return (
    <figure aria-label={label} className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="netWorthMinor"
            stroke={S1}
            strokeWidth={2}
            fill={S1}
            fillOpacity={0.12}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

export function NetWorthChart({
  points,
  currency,
  granularity,
  compare,
}: {
  points: NetWorthBucket[];
  currency: string;
  granularity: Granularity;
  compare: boolean;
}) {
  const ax = useChartAxes();
  if (points.every((p) => p.netWorthMinor === 0 && p.assetsMinor === 0)) {
    return <NoData>Add accounts or holdings to see your net worth over time.</NoData>;
  }
  const rows: NwRow[] = points.map((p, i) => ({
    ...p,
    prevBucket: i ? points[i - 1]!.netWorthMinor : null,
  }));
  const last = points.at(-1)!;
  return (
    <ChartFrame
      label="Net worth trend"
      summary={`Net worth ${formatMoney(points[0]!.netWorthMinor, currency)} at the first point, ${formatMoney(last.netWorthMinor, currency)} at the last.`}
      legend={[
        { label: "Net worth", color: S1 },
        ...(compare ? [{ label: "Previous period", color: PREV, shape: "dash" as const }] : []),
      ]}
      rows={rows}
      columns={[
        { label: "Period", value: (r) => bucketLabel(r.start, r.end, granularity) },
        {
          label: "Net worth",
          numeric: true,
          value: (r) => <Amount minor={r.netWorthMinor} currency={currency} />,
        },
        ...(compare
          ? [
              {
                label: "Previous period",
                numeric: true,
                value: (r: NwRow) =>
                  r.previousNetWorthMinor === null ? (
                    "—"
                  ) : (
                    <Amount minor={r.previousNetWorthMinor} currency={currency} />
                  ),
              },
            ]
          : []),
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="start"
            tickFormatter={(s: string) => bucketTick(s, granularity)}
            {...ax.axis}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={16}
          />
          <YAxis
            tickFormatter={ax.money(currency)}
            {...ax.axis}
            axisLine={false}
            width={ax.yWidth(88)}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(p) => <NetWorthTip {...p} currency={currency} g={granularity} />}
          />
          <Area
            type="monotone"
            dataKey="netWorthMinor"
            stroke={S1}
            strokeWidth={2}
            fill={S1}
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: S1 }}
            isAnimationActive={false}
          />
          {compare ? (
            <Line
              type="monotone"
              dataKey="previousNetWorthMinor"
              stroke={PREV}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: PREV }}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// --------------------------------------------------------------------- assets vs liabilities

type AlRow = NetWorthBucket & { negLiabilities: number };

function AlTip({
  active,
  payload,
  currency,
  g,
}: TooltipContentProps & { currency: string; g: Granularity }) {
  const p = active ? (payload?.[0]?.payload as AlRow | undefined) : undefined;
  if (!p) return null;
  return (
    <TooltipShell title={bucketLabel(p.start, p.end, g)}>
      <TooltipRow
        color={S1}
        label="Assets"
        value={<Amount minor={p.assetsMinor} currency={currency} />}
      />
      <TooltipRow
        color={S2}
        label="Liabilities"
        value={<Amount minor={p.liabilitiesMinor} currency={currency} />}
      />
      <TooltipRow
        label="Net worth"
        value={<Amount minor={p.netWorthMinor} currency={currency} />}
      />
    </TooltipShell>
  );
}

/** Closing assets (up) and liabilities (down) per bucket — one axis, stacked by sign. */
export function AssetsLiabilitiesChart({
  points,
  currency,
  granularity,
}: {
  points: NetWorthBucket[];
  currency: string;
  granularity: Granularity;
}) {
  const ax = useChartAxes();
  if (points.every((p) => p.assetsMinor === 0 && p.liabilitiesMinor === 0)) {
    return <NoData>No balances in this range yet.</NoData>;
  }
  const rows: AlRow[] = points.map((p) => ({ ...p, negLiabilities: -p.liabilitiesMinor }));
  return (
    <ChartFrame
      label="Assets and liabilities"
      summary={`At the end: assets ${formatMoney(points.at(-1)!.assetsMinor, currency)}, liabilities ${formatMoney(points.at(-1)!.liabilitiesMinor, currency)}.`}
      legend={[
        { label: "Assets", color: S1, shape: "box" },
        { label: "Liabilities", color: S2, shape: "box" },
      ]}
      rows={rows}
      columns={[
        { label: "Period", value: (r) => bucketLabel(r.start, r.end, granularity) },
        {
          label: "Assets",
          numeric: true,
          value: (r) => <Amount minor={r.assetsMinor} currency={currency} />,
        },
        {
          label: "Liabilities",
          numeric: true,
          value: (r) => <Amount minor={r.liabilitiesMinor} currency={currency} />,
        },
      ]}
      minWidthPx={rows.length > 30 ? rows.length * BAR_PX : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          stackOffset="sign"
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="start"
            tickFormatter={(s: string) => bucketTick(s, granularity)}
            {...ax.axis}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={12}
          />
          <YAxis
            tickFormatter={ax.money(currency)}
            {...ax.axis}
            axisLine={false}
            width={ax.yWidth(88)}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={(p) => <AlTip {...p} currency={currency} g={granularity} />}
          />
          <Bar
            dataKey="assetsMinor"
            stackId="s"
            fill={S1}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="negLiabilities"
            stackId="s"
            fill={S2}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// -------------------------------------------------------------------------------- cashflow

function CashTip({
  active,
  payload,
  currency,
  g,
}: TooltipContentProps & { currency: string; g: Granularity }) {
  const p = active ? (payload?.[0]?.payload as CashflowBucket | undefined) : undefined;
  if (!p) return null;
  return (
    <TooltipShell title={bucketLabel(p.start, p.end, g)}>
      <TooltipRow
        color={S1}
        label="Income"
        value={<Amount minor={p.incomeMinor} currency={currency} />}
      />
      <TooltipRow
        color={S2}
        label="Expense"
        value={<Amount minor={p.expenseMinor} currency={currency} />}
      />
      <TooltipRow
        label="Savings"
        value={<Amount minor={p.savingsMinor} currency={currency} signed />}
      />
      <TooltipRow label="Savings rate" value={pct(p.savingsRateBp)} />
      {p.previous ? (
        <>
          <TooltipRow
            label="Previous income"
            value={<Amount minor={p.previous.incomeMinor} currency={currency} />}
          />
          <TooltipRow
            label="Previous expense"
            value={<Amount minor={p.previous.expenseMinor} currency={currency} />}
          />
        </>
      ) : null}
    </TooltipShell>
  );
}

/** Income vs expense SUMMED per bucket (grouped bars). */
export function CashflowChart({
  points,
  currency,
  granularity,
}: {
  points: CashflowBucket[];
  currency: string;
  granularity: Granularity;
}) {
  const ax = useChartAxes();
  if (points.every((p) => p.incomeMinor === 0 && p.expenseMinor === 0)) {
    return <NoData>No income or expenses in this range.</NoData>;
  }
  return (
    <ChartFrame
      label="Income and expense"
      summary={`${points.length} periods of income and expense.`}
      legend={[
        { label: "Income", color: S1, shape: "box" },
        { label: "Expense", color: S2, shape: "box" },
      ]}
      rows={points}
      columns={[
        { label: "Period", value: (r) => bucketLabel(r.start, r.end, granularity) },
        {
          label: "Income",
          numeric: true,
          value: (r) => <Amount minor={r.incomeMinor} currency={currency} />,
        },
        {
          label: "Expense",
          numeric: true,
          value: (r) => <Amount minor={r.expenseMinor} currency={currency} />,
        },
        { label: "Savings rate", numeric: true, value: (r) => pct(r.savingsRateBp) },
      ]}
      minWidthPx={points.length > 30 ? points.length * BAR_PX * 1.6 : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="20%"
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="start"
            tickFormatter={(s: string) => bucketTick(s, granularity)}
            {...ax.axis}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={12}
          />
          <YAxis
            tickFormatter={ax.money(currency)}
            {...ax.axis}
            axisLine={false}
            width={ax.yWidth(88)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={(p) => <CashTip {...p} currency={currency} g={granularity} />}
          />
          <Bar dataKey="incomeMinor" fill={S1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expenseMinor" fill={S2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

type RateRow = CashflowBucket & { rate: number | null };

function RateTip({ active, payload, g }: TooltipContentProps & { g: Granularity }) {
  const p = active ? (payload?.[0]?.payload as RateRow | undefined) : undefined;
  if (!p) return null;
  return (
    <TooltipShell title={bucketLabel(p.start, p.end, g)}>
      <TooltipRow color={S1} label="Savings rate" value={pct(p.savingsRateBp)} />
      {p.previous ? (
        <TooltipRow label="Previous period" value={pct(p.previous.savingsRateBp)} />
      ) : null}
    </TooltipShell>
  );
}

/**
 * Savings rate per bucket — its own small chart under income vs expense (owner decision: no
 * dual axis). Gaps where income is 0 (rate undefined).
 */
export function SavingsRateChart({
  points,
  granularity,
}: {
  points: CashflowBucket[];
  granularity: Granularity;
}) {
  const ax = useChartAxes();
  const rows: RateRow[] = points.map((p) => ({
    ...p,
    rate: p.savingsRateBp === null ? null : p.savingsRateBp / 100,
  }));
  if (rows.every((r) => r.rate === null)) {
    return (
      <p className="text-sm text-muted-foreground">
        No income in this range, so there is no savings rate yet.
      </p>
    );
  }
  return (
    <ChartFrame
      label="Savings rate"
      summary="Savings as a share of income per period; blank where there was no income."
      rows={rows}
      columns={[
        { label: "Period", value: (r) => bucketLabel(r.start, r.end, granularity) },
        { label: "Savings rate", numeric: true, value: (r) => pct(r.savingsRateBp) },
      ]}
      height="h-28"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="start"
            tickFormatter={(s: string) => bucketTick(s, granularity)}
            {...ax.axis}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={16}
          />
          <YAxis
            tickFormatter={(v: number) => `${Math.round(v)}%`}
            {...ax.axis}
            axisLine={false}
            width={ax.yWidth(88)}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(p) => <RateTip {...p} g={granularity} />}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke={S1}
            strokeWidth={2}
            dot={{ r: 3, fill: S1, stroke: "var(--card)", strokeWidth: 1 }}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: S1 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ------------------------------------------------------------------------------- allocation

/** Allocation donut by class (fixed class colours; 2px surface ring between slices). */
export function AllocationDonut({ allocation }: { allocation: Allocation }) {
  const router = useRouter();
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
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={classes}
              dataKey="valueMinor"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(_, index) => {
                const c = classes[index];
                if (c) router.push(`/assets?class=${c.id}`);
              }}
              className="cursor-pointer"
            >
              {classes.map((c) => (
                <Cell key={c.id} fill={vizColor(c.color)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const c = active
                  ? (payload?.[0]?.payload as (typeof classes)[number] | undefined)
                  : undefined;
                if (!c) return null;
                return (
                  <TooltipShell title={c.name}>
                    <TooltipRow
                      color={vizColor(c.color)}
                      label={formatPercentBp(c.shareBp)}
                      value={<Amount minor={c.valueMinor} currency={currency} />}
                    />
                  </TooltipShell>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </figure>
      <ul className="grid gap-1 text-sm" aria-label="Asset classes">
        {classes.map((c) => (
          <li key={c.id}>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left hover:underline"
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
          <Link href={href(c.id)} className="group grid gap-1">
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
