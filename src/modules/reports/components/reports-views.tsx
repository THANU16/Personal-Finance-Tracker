"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  AXIS,
  Amount,
  ChartFrame,
  NoData,
  TooltipRow,
  TooltipShell,
  moneyTick,
} from "@/components/charts/chart-kit";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FlowPoint } from "@/domain/analytics";
import { CategoryBreakdownCard } from "@/modules/reports/components/category-breakdown-card";
import { InvestingSection } from "@/modules/reports/components/investing-section";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Portfolio } from "@/modules/holdings/queries";
import type {
  CategoriesReport,
  IncomeReport,
  MonthlySummaryDTO,
  NetWorthRow,
  RealisedReport,
} from "@/modules/reports/service";

const S1 = "var(--viz-series-1)";
const S2 = "var(--viz-series-2)";
const pct = (bp: number | null) => (bp === null ? "—" : formatPercentBp(bp));
const signedPct = (bp: number | null) =>
  bp === null ? "—" : formatPercentBp(bp, { signed: true });
const monthLabel = (m: string) => format(parseISO(`${m}-01`), "MMMM yyyy");

const TH = "px-3 py-2 font-medium";
const TD = "px-3 py-2";
const NUM = "px-3 py-2 text-right tabular-nums";

function Table({
  caption,
  head,
  children,
  foot,
}: {
  caption: string;
  head: React.ReactNode;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">{head}</thead>
        <tbody>{children}</tbody>
        {foot ? <tfoot className="border-t bg-muted/50 font-medium">{foot}</tfoot> : null}
      </table>
    </div>
  );
}

/** A select that navigates (keeps the tab and the other period value). */
export function PeriodPicker({
  tab,
  name,
  value,
  options,
  keep = {},
  label,
}: {
  tab: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  keep?: Record<string, string>;
  label?: string;
}) {
  const router = useRouter();
  const id = `period-${name}`;
  return (
    <div className="flex items-center gap-2 text-sm">
      {label ? (
        <label htmlFor={id} className="text-muted-foreground">
          {label}
        </label>
      ) : null}
      <Select
        value={value}
        onValueChange={(v) =>
          router.push(`/reports?${new URLSearchParams({ tab, ...keep, [name]: String(v) })}`)
        }
        items={options}
      >
        <SelectTrigger id={id} className="w-36" aria-label={label ?? name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ------------------------------------------------------------------------------- monthly

export function MonthlyView({ data }: { data: MonthlySummaryDTO }) {
  const r = data.review;
  const ccy = r.currency;
  const BUDGET: Record<"ok" | "warn" | "over", string> = {
    ok: "On budget",
    warn: "80% used",
    over: "Over budget",
  };
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {monthLabel(r.month)} ·{" "}
        {data.generatedAt
          ? `review saved on ${format(parseISO(data.generatedAt), "d MMM yyyy")}`
          : "calculated now from your ledger"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Income"
          value={<Money valueMinor={r.incomeMinor} currency={ccy} />}
          hint={`${signedPct(r.incomeChangeBp)} vs previous month`}
        />
        <StatCard
          label="Expense"
          value={<Money valueMinor={r.expenseMinor} currency={ccy} />}
          hint={`${signedPct(r.expenseChangeBp)} vs previous month`}
        />
        <StatCard
          label="Savings rate"
          value={pct(r.savingsRateBp)}
          hint={
            <>
              Saved <Money valueMinor={r.savingsMinor} currency={ccy} /> · previous{" "}
              {pct(r.previous.savingsRateBp)}
            </>
          }
        />
        <StatCard
          label="Net worth change"
          value={<Money valueMinor={r.netWorth.changeMinor} currency={ccy} signed />}
          hint={
            <>
              to <Money valueMinor={r.netWorth.endMinor} currency={ccy} /> (
              {signedPct(r.netWorth.changeBp)})
            </>
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryBreakdownCard
          title="Expenses by category"
          amountLabel="Spent"
          rows={r.expenseCategories}
          currency={ccy}
          empty="No spending this month."
        />
        <CategoryBreakdownCard
          title="Income by category"
          amountLabel="Received"
          rows={r.incomeCategories}
          currency={ccy}
          empty="No income this month."
        />
      </div>
      <InvestingSection review={r} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Budgets</CardTitle>
          </CardHeader>
          <CardContent>
            {r.budgets.length === 0 ? (
              <NoData>No budgets for this month.</NoData>
            ) : (
              <ul className="divide-y text-sm">
                {r.budgets.map((b) => (
                  <li key={b.categoryId} className="flex items-center justify-between gap-2 py-2">
                    <span>{b.name}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <Money valueMinor={b.spentMinor} currency={ccy} /> /{" "}
                      <Money valueMinor={b.budgetMinor} currency={ccy} />
                      <Badge
                        variant={
                          b.status === "over"
                            ? "destructive"
                            : b.status === "warn"
                              ? "outline"
                              : "secondary"
                        }
                      >
                        {BUDGET[b.status]}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Insights</CardTitle>
          </CardHeader>
          <CardContent>
            {r.insights.length === 0 ? (
              <NoData>Nothing stood out.</NoData>
            ) : (
              <ul className="grid gap-2 text-sm">
                {r.insights.map((i) => (
                  <li key={i.key}>
                    <Link
                      href={i.href}
                      className="block rounded-lg border px-3 py-2 hover:bg-muted/50"
                    >
                      <span className="font-medium">{i.title}</span>
                      <span className="block text-muted-foreground">{i.body}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- income vs expense

function FlowTip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const p = active ? (payload?.[0]?.payload as FlowPoint | undefined) : undefined;
  if (!p) return null;
  return (
    <TooltipShell title={monthLabel(p.key.slice(0, 7))}>
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
      <TooltipRow label="Savings rate" value={pct(p.savingsRateBp)} />
    </TooltipShell>
  );
}

export function IncomeExpenseView({ data }: { data: { currency: string; points: FlowPoint[] } }) {
  const ccy = data.currency;
  if (data.points.every((p) => p.incomeMinor === 0 && p.expenseMinor === 0)) {
    return <NoData>No income or expense in the last 12 complete months.</NoData>;
  }
  return (
    <Card>
      <CardContent className="pt-4">
        <ChartFrame
          label="Income vs expense, last 12 complete months"
          summary={`${data.points.length} months of income and expense.`}
          legend={[
            { label: "Income", color: S1, shape: "box" },
            { label: "Expense", color: S2, shape: "box" },
          ]}
          rows={data.points}
          height="h-72"
          columns={[
            { label: "Month", value: (p) => monthLabel(p.key.slice(0, 7)) },
            {
              label: "Income",
              numeric: true,
              value: (p) => <Amount minor={p.incomeMinor} currency={ccy} />,
            },
            {
              label: "Expense",
              numeric: true,
              value: (p) => <Amount minor={p.expenseMinor} currency={ccy} />,
            },
            {
              label: "Savings",
              numeric: true,
              value: (p) => <Amount minor={p.savingsMinor} currency={ccy} />,
            },
            { label: "Savings rate", numeric: true, value: (p) => pct(p.savingsRateBp) },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.points}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              barGap={2}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="key"
                tickFormatter={(k: string) => format(parseISO(k), "MMM yy")}
                {...AXIS}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis tickFormatter={moneyTick(ccy)} {...AXIS} axisLine={false} width={88} />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                content={(p) => <FlowTip {...p} currency={ccy} />}
              />
              <Bar
                dataKey="incomeMinor"
                fill={S1}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
              <Bar
                dataKey="expenseMinor"
                fill={S2}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------- categories

export function CategoriesView({ data }: { data: CategoriesReport }) {
  const ccy = data.currency;
  if (data.rows.length === 0) return <NoData>No spending in this period.</NoData>;
  return (
    <Table
      caption={`Spending by category ${data.from} to ${data.to}`}
      head={
        <tr>
          <th scope="col" className={cn(TH, "text-left")}>
            Category
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Spent
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Share
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Previous period
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Change
          </th>
        </tr>
      }
      foot={
        <tr>
          <td className={TD}>Total</td>
          <td className={NUM}>
            <Money valueMinor={data.totalMinor} currency={ccy} />
          </td>
          <td colSpan={3} />
        </tr>
      }
    >
      {data.rows.flatMap((r) => [
        <tr key={r.categoryId} className="border-t">
          <td className={cn(TD, "font-medium")}>
            <Link
              href={`/transactions?category=${r.categoryId}&from=${data.from}-01`}
              className="underline-offset-4 hover:underline"
            >
              {r.name}
            </Link>
          </td>
          <td className={NUM}>
            <Money valueMinor={r.amountMinor} currency={ccy} />
          </td>
          <td className={NUM}>{pct(r.shareBp)}</td>
          <td className={NUM}>
            <Money valueMinor={r.previousMinor} currency={ccy} />
          </td>
          <td className={NUM}>{r.changeBp === null ? "—" : signedPct(r.changeBp)}</td>
        </tr>,
        ...r.children.map((c) => (
          <tr key={`${r.categoryId}-${c.categoryId}`} className="text-muted-foreground">
            <td className={cn(TD, "pl-8")}>{c.name}</td>
            <td className={NUM}>
              <Money valueMinor={c.amountMinor} currency={ccy} />
            </td>
            <td colSpan={3} />
          </tr>
        )),
      ])}
    </Table>
  );
}

// ------------------------------------------------------------------------------- performance

export function PerformanceView({ data }: { data: Portfolio }) {
  const t = data.totals;
  if (data.holdings.length === 0) return <NoData>No holdings yet.</NoData>;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Value"
          value={<Money valueMinor={t.valueMinor} currency={t.currency} />}
          hint={
            <>
              Invested <Money valueMinor={t.investedMinor} currency={t.currency} />
            </>
          }
        />
        <StatCard
          label="Unrealised"
          value={<Money valueMinor={t.unrealizedGainMinor} currency={t.currency} signed />}
          hint={signedPct(t.unrealizedBp)}
        />
        <StatCard
          label="Realised + income"
          value={
            <Money valueMinor={t.realizedGainMinor + t.incomeMinor} currency={t.currency} signed />
          }
        />
        <StatCard label="XIRR" value={pct(t.xirrBp)} hint="Money-weighted, all holdings" />
      </div>
      <Table
        caption="Investment performance by class and holding"
        head={
          <tr>
            <th scope="col" className={cn(TH, "text-left")}>
              Holding
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Invested
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Value
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Unrealised
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Realised
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Income
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              XIRR
            </th>
          </tr>
        }
      >
        {data.classes.flatMap((c) => [
          <tr key={c.id} className="border-t bg-muted/30 font-medium">
            <td className={TD}>{c.name}</td>
            <td className={NUM}>
              <Money valueMinor={c.investedMinor} currency={t.currency} />
            </td>
            <td className={NUM}>
              <Money valueMinor={c.valueMinor} currency={t.currency} />
            </td>
            <td className={NUM}>
              <Money valueMinor={c.unrealizedGainMinor} currency={t.currency} signed />
            </td>
            <td className={NUM} />
            <td className={NUM} />
            <td className={NUM}>{pct(c.xirrBp)}</td>
          </tr>,
          ...c.holdings.map((h) => (
            <tr
              key={h.id}
              className={cn("border-t", h.status === "closed" && "text-muted-foreground")}
            >
              <td className={cn(TD, "pl-6")}>
                <Link href={`/assets/${h.id}`} className="underline-offset-4 hover:underline">
                  {h.name}
                </Link>
                {h.status === "closed" ? " (closed)" : ""}
              </td>
              <td className={NUM}>
                <Money valueMinor={h.investedMinor} currency={h.currency} />
              </td>
              <td className={NUM}>
                <Money valueMinor={h.currentValueMinor} currency={h.currency} />
              </td>
              <td className={NUM}>
                <Money valueMinor={h.unrealizedGainMinor} currency={h.currency} signed />
              </td>
              <td className={NUM}>
                <Money valueMinor={h.realizedGainMinor} currency={h.currency} signed />
              </td>
              <td className={NUM}>
                <Money valueMinor={h.incomeReceivedMinor} currency={h.currency} />
              </td>
              <td className={NUM}>{pct(h.xirrBp)}</td>
            </tr>
          )),
        ])}
      </Table>
      <p className="text-xs text-muted-foreground">
        Class rows are in {t.currency}; holdings in their own currency. XIRR needs 90 days of
        history.
      </p>
    </div>
  );
}

// -------------------------------------------------------------------------- realised / income

export function RealisedView({ data }: { data: RealisedReport }) {
  const ccy = data.currency;
  if (data.lines.length === 0) return <NoData>No redemptions in {data.year}.</NoData>;
  return (
    <Table
      caption={`Realised gains ${data.year}`}
      head={
        <tr>
          <th scope="col" className={cn(TH, "text-left")}>
            Date
          </th>
          <th scope="col" className={cn(TH, "text-left")}>
            Holding
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Redeemed
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Fee
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Cost removed
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Realised gain
          </th>
        </tr>
      }
      foot={
        <tr>
          <td className={TD} colSpan={2}>
            Total {data.year}
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.amountMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.feeMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.costRemovedMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.realizedGainMinor} currency={ccy} signed />
          </td>
        </tr>
      }
    >
      {data.lines.map((l) => (
        <tr key={l.id} className="border-t">
          <td className={TD}>{format(parseISO(l.date), "d MMM yyyy")}</td>
          <td className={TD}>
            <Link href={`/assets/${l.holdingId}`} className="underline-offset-4 hover:underline">
              {l.holdingName}
            </Link>
          </td>
          <td className={NUM}>
            <Money valueMinor={l.amountMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={l.feeMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={l.costRemovedMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={l.realizedGainMinor} currency={ccy} signed />
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function IncomeView({ data }: { data: IncomeReport }) {
  const ccy = data.currency;
  if (data.rows.length === 0) return <NoData>No investment income in {data.year}.</NoData>;
  return (
    <Table
      caption={`Investment income and tax ${data.year}`}
      head={
        <tr>
          <th scope="col" className={cn(TH, "text-left")}>
            Holding
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Gross
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Tax withheld
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Net
          </th>
          <th scope="col" className={cn(TH, "text-right")}>
            Reinvested
          </th>
        </tr>
      }
      foot={
        <tr>
          <td className={TD}>Total {data.year}</td>
          <td className={NUM}>
            <Money valueMinor={data.totals.grossMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.taxMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.netMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={data.totals.reinvestedMinor} currency={ccy} />
          </td>
        </tr>
      }
    >
      {data.rows.map((r) => (
        <tr key={r.holdingId} className="border-t">
          <td className={TD}>
            <Link href={`/assets/${r.holdingId}`} className="underline-offset-4 hover:underline">
              {r.holdingName}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {Object.keys(r.byKind).join(", ")}
            </span>
          </td>
          <td className={NUM}>
            <Money valueMinor={r.grossMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={r.taxMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={r.netMinor} currency={ccy} />
          </td>
          <td className={NUM}>
            <Money valueMinor={r.reinvestedMinor} currency={ccy} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

// ------------------------------------------------------------------------------- net worth

function NwTip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const r = active ? (payload?.[0]?.payload as NetWorthRow | undefined) : undefined;
  if (!r) return null;
  return (
    <TooltipShell title={format(parseISO(r.date), "d MMM yyyy")}>
      <TooltipRow
        color={S1}
        label="Net worth"
        value={<Amount minor={r.netWorthMinor} currency={currency} />}
      />
      <TooltipRow label="Assets" value={<Amount minor={r.assetsMinor} currency={currency} />} />
      <TooltipRow
        label="Liabilities"
        value={<Amount minor={r.liabilitiesMinor} currency={currency} />}
      />
    </TooltipShell>
  );
}

export function NetWorthView({ data }: { data: { currency: string; rows: NetWorthRow[] } }) {
  const ccy = data.currency;
  if (data.rows.length === 0)
    return <NoData>Add accounts or holdings to see your net worth history.</NoData>;
  return (
    <Card>
      <CardContent className="pt-4">
        <ChartFrame
          label="Net worth at each month end"
          summary={`${data.rows.length} month ends; the last point is today.`}
          legend={[{ label: "Net worth", color: S1 }]}
          rows={[...data.rows].reverse()}
          height="h-72"
          columns={[
            { label: "Date", value: (r) => format(parseISO(r.date), "d MMM yyyy") },
            {
              label: "Net worth",
              numeric: true,
              value: (r) => <Amount minor={r.netWorthMinor} currency={ccy} />,
            },
            {
              label: "Assets",
              numeric: true,
              value: (r) => <Amount minor={r.assetsMinor} currency={ccy} />,
            },
            {
              label: "Liabilities",
              numeric: true,
              value: (r) => <Amount minor={r.liabilitiesMinor} currency={ccy} />,
            },
            {
              label: "Invested",
              numeric: true,
              value: (r) => <Amount minor={r.investedMinor} currency={ccy} />,
            },
            {
              label: "Cash",
              numeric: true,
              value: (r) => <Amount minor={r.cashMinor} currency={ccy} />,
            },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => format(parseISO(d), "MMM yy")}
                {...AXIS}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={16}
              />
              <YAxis tickFormatter={moneyTick(ccy)} {...AXIS} axisLine={false} width={88} />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                content={(p) => <NwTip {...p} currency={ccy} />}
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
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </CardContent>
    </Card>
  );
}
