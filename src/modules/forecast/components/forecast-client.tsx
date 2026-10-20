"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Info } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FORECAST_HORIZONS, type Breach, type ForecastEvent } from "@/domain/forecast";
import type { Insight } from "@/domain/insights";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ForecastDTO, ProjectionDTO } from "@/modules/forecast/service";

const S1 = "var(--viz-series-1)";
const S2 = "var(--viz-series-2)";
const S3 = "var(--viz-cat-3)";
const DANGER = "var(--destructive)";
const fmtDay = (d: string) => format(parseISO(d), "d MMM");
const fmtLong = (d: string) => format(parseISO(d), "EEE d MMM yyyy");
const KIND: Record<ForecastEvent["kind"], string> = {
  recurring: "Recurring",
  sip: "SIP",
  emi: "EMI",
  card_due: "Card due",
};

function BreachBadge({ breach }: { breach: Breach | null }) {
  if (!breach) return <Badge variant="secondary">OK</Badge>;
  return (
    <Badge variant={breach.below === "zero" ? "destructive" : "outline"}>
      <AlertTriangle className="size-3" aria-hidden />
      {breach.below === "zero" ? "Below zero" : "Below minimum"} {fmtDay(breach.date)}
    </Badge>
  );
}

function HorizonNav({ horizon }: { horizon: number }) {
  return (
    <nav aria-label="Horizon" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
      {FORECAST_HORIZONS.map((h) => (
        <Link
          key={h}
          href={h === 30 ? "/forecast" : `/forecast?days=${h}`}
          aria-current={h === horizon ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1",
            h === horizon
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {h} days
        </Link>
      ))}
    </nav>
  );
}

type DayRow = ForecastDTO["days"][number];

function BalanceTip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const r = active ? (payload?.[0]?.payload as DayRow | undefined) : undefined;
  if (!r) return null;
  return (
    <TooltipShell title={fmtLong(r.date)}>
      <TooltipRow
        color={S1}
        label="Total cash"
        value={<Amount minor={r.totalMinor} currency={currency} />}
      />
    </TooltipShell>
  );
}

function BalanceChart({ f }: { f: ForecastDTO }) {
  if (!f.accounts.length)
    return <NoData>Add a bank, cash or wallet account to see a forecast.</NoData>;
  const floor = Math.max(0, f.minimumMinor);
  const values = f.days.map((d) => d.totalMinor);
  const lo = Math.min(0, ...values);
  const hi = Math.max(floor, ...values);
  return (
    <ChartFrame
      label="Total cash balance forecast"
      summary={`Starts at ${f.days[0]?.totalMinor ?? 0} and ends at ${f.days.at(-1)?.totalMinor ?? 0} (minor units); lowest on ${f.total.lowestDate}.`}
      legend={[
        { label: "Total cash", color: S1 },
        {
          label: f.minimumMinor > 0 ? "Below your minimum" : "Below zero",
          color: DANGER,
          shape: "box",
        },
      ]}
      rows={f.days}
      columns={[
        { label: "Date", value: (r) => fmtLong(r.date) },
        {
          label: "Total cash",
          numeric: true,
          value: (r) => <Amount minor={r.totalMinor} currency={f.currency} />,
        },
      ]}
      height="h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={f.days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDay}
            {...AXIS}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={moneyTick(f.currency)}
            {...AXIS}
            axisLine={false}
            width={88}
            domain={[lo, hi]}
          />
          <ReferenceArea
            y1={lo}
            y2={floor}
            fill={DANGER}
            fillOpacity={0.08}
            ifOverflow="extendDomain"
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          {f.minimumMinor > 0 ? (
            <ReferenceLine y={f.minimumMinor} stroke={DANGER} strokeDasharray="4 4" />
          ) : null}
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(p) => <BalanceTip {...p} currency={f.currency} />}
          />
          <Area
            type="stepAfter"
            dataKey="totalMinor"
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
  );
}

function ForecastCard({ f }: { f: ForecastDTO }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Cash forecast</CardTitle>
          <CardDescription>
            {fmtLong(f.from)} – {fmtLong(f.to)} · bank, cash, wallet, broker cash and Opportunity
            Fund accounts
            {f.minimumMinor > 0 ? (
              <>
                {" "}
                · warning below <Money valueMinor={f.minimumMinor} currency={f.currency} />
              </>
            ) : null}
            .
          </CardDescription>
        </div>
        <HorizonNav horizon={f.horizon} />
      </CardHeader>
      <CardContent className="grid gap-4">
        {f.total.breach ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>
              Total cash goes{" "}
              {f.total.breach.below === "zero" ? "below zero" : "below your minimum"} on{" "}
              {fmtLong(f.total.breach.date)} (
              <Money valueMinor={f.total.breach.balanceMinor} currency={f.currency} />
              ).
            </span>
          </p>
        ) : null}
        <BalanceChart f={f} />
        {f.accounts.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Lowest point per account</caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Account
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Today
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Lowest
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    End
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {f.accounts.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/accounts/${a.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Money valueMinor={a.startMinor} currency={f.currency} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Money valueMinor={a.lowestMinor} currency={f.currency} />
                      <div className="text-xs text-muted-foreground">{fmtDay(a.lowestDate)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Money valueMinor={a.endMinor} currency={f.currency} />
                    </td>
                    <td className="px-3 py-2">
                      <BreachBadge breach={a.breach} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {f.fxMissing ? (
          <p className="text-xs text-muted-foreground">
            {f.fxMissing} item(s) left out: no exchange rate.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventsCard({ f }: { f: ForecastDTO }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming</CardTitle>
        <CardDescription>What the forecast includes. Overdue items count today.</CardDescription>
      </CardHeader>
      <CardContent>
        {f.events.length === 0 ? (
          <NoData>Nothing planned. Add recurring items, SIPs or loans to see them here.</NoData>
        ) : (
          <ul className="divide-y text-sm">
            {f.events.map((e, i) => (
              <li
                key={`${e.date}-${e.title}-${i}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">{e.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmtLong(e.date)} · {KIND[e.kind]}
                    {e.accountId === null ? " · no account (total only)" : ""}
                  </span>
                </span>
                <Money valueMinor={e.deltaMinor} currency={f.currency} signed />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type ProjRow = ProjectionDTO["points"][number];

function ProjectionTip({ active, payload, p }: TooltipContentProps & { p: ProjectionDTO }) {
  const r = active ? (payload?.[0]?.payload as ProjRow | undefined) : undefined;
  if (!r) return null;
  return (
    <TooltipShell title={r.year === 0 ? "Today" : `In ${r.year} year${r.year === 1 ? "" : "s"}`}>
      <TooltipRow
        color={S2}
        label={`High (${formatPercentBp(p.annualReturnBp + 200)})`}
        value={<Amount minor={r.highMinor} currency={p.currency} />}
      />
      <TooltipRow
        color={S1}
        label={`Expected (${formatPercentBp(p.annualReturnBp)})`}
        value={<Amount minor={r.baseMinor} currency={p.currency} />}
      />
      <TooltipRow
        color={S3}
        dashed
        label={`Low (${formatPercentBp(Math.max(0, p.annualReturnBp - 200))})`}
        value={<Amount minor={r.lowMinor} currency={p.currency} />}
      />
    </TooltipShell>
  );
}

function ProjectionCard({ p }: { p: ProjectionDTO }) {
  const at = (y: number) => p.points.find((x) => x.year === y);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Net worth projection</CardTitle>
        <CardDescription>
          An estimate, not a promise: today&apos;s net worth plus{" "}
          <Money valueMinor={p.monthlyContributionMinor} currency={p.currency} /> a month (active
          SIPs), compounded monthly at {formatPercentBp(p.annualReturnBp)} ± 2 points a year. Change
          the return in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          {[5, 10].map((y) => {
            const r = at(y);
            return r ? (
              <div key={y} className="rounded-lg border p-3">
                <dt className="text-sm text-muted-foreground">In {y} years</dt>
                <dd className="text-xl font-semibold">
                  <Money valueMinor={r.baseMinor} currency={p.currency} compact />
                </dd>
                <dd className="text-xs text-muted-foreground">
                  <Money valueMinor={r.lowMinor} currency={p.currency} compact /> –{" "}
                  <Money valueMinor={r.highMinor} currency={p.currency} compact />
                </dd>
              </div>
            ) : null;
          })}
        </dl>
        <ChartFrame
          label="Net worth projection"
          summary="Low, expected and high scenarios for the next 10 years."
          legend={[
            { label: "High", color: S2 },
            { label: "Expected", color: S1 },
            { label: "Low", color: S3, shape: "dash" },
          ]}
          rows={p.points}
          columns={[
            { label: "Year", value: (r) => (r.year === 0 ? "Today" : `+${r.year}`) },
            {
              label: "Low",
              numeric: true,
              value: (r) => <Amount minor={r.lowMinor} currency={p.currency} />,
            },
            {
              label: "Expected",
              numeric: true,
              value: (r) => <Amount minor={r.baseMinor} currency={p.currency} />,
            },
            {
              label: "High",
              numeric: true,
              value: (r) => <Amount minor={r.highMinor} currency={p.currency} />,
            },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={p.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="year"
                tickFormatter={(y: number) => (y === 0 ? "Now" : `+${y}y`)}
                {...AXIS}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis tickFormatter={moneyTick(p.currency)} {...AXIS} axisLine={false} width={88} />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                content={(t) => <ProjectionTip {...t} p={p} />}
              />
              <Line
                dataKey="highMinor"
                stroke={S2}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="baseMinor"
                stroke={S1}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="lowMinor"
                stroke={S3}
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </CardContent>
    </Card>
  );
}

function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Insights</CardTitle>
        <CardDescription>Simple checks on your own numbers, most important first.</CardDescription>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <NoData>Nothing stands out right now.</NoData>
        ) : (
          <ul className="grid gap-2">
            {insights.map((i) => (
              <li key={i.key}>
                <Link
                  href={i.href}
                  className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  {i.severity === "warning" ? (
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-amber-600"
                      aria-label="Warning"
                    />
                  ) : (
                    <Info
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-label="Info"
                    />
                  )}
                  <span>
                    <span className="font-medium">{i.title}</span>
                    <span className="block text-muted-foreground">{i.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ForecastClient({
  forecast,
  projection,
  insights,
}: {
  forecast: ForecastDTO;
  projection: ProjectionDTO;
  insights: Insight[];
}) {
  return (
    <div className="grid gap-4">
      <ForecastCard f={forecast} />
      <div className="grid gap-4 lg:grid-cols-2">
        <EventsCard f={forecast} />
        <InsightsCard insights={insights} />
      </div>
      <ProjectionCard p={projection} />
    </div>
  );
}
