import Link from "next/link";
import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { CalendarClock, CircleAlert, Construction } from "lucide-react";
import {
  AllocationDonut,
  AssetsLiabilitiesChart,
  CashflowChart,
  NetWorthChart,
  SavingsRateChart,
  TopCategoriesList,
} from "@/components/charts/dashboard-charts";
import { BucketBar } from "@/components/shared/bucket-bar";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { TimeRangeBar } from "@/components/shared/time-range-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseRangeView, type RangeView } from "@/domain/date-range";
import { utcToBusinessDate } from "@/domain/dates";
import { formatPercentBp } from "@/lib/format";
import { NetWorthMenu, SafeToSpendValue } from "@/modules/dashboard/components/dashboard-client";
import {
  allocationAsOf,
  cashflowSeries,
  getAttention,
  getEarliestKey,
  getSafeToSpend,
  getStanding,
  getUpcoming,
  netWorthSeries,
  topExpenseCategories,
} from "@/modules/dashboard/queries";
import { getCurrentUser } from "@/server/auth/require-user";
import type { Ctx } from "@/server/ctx";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Session + range view, once per request (every widget reads it). */
const resolve = cache(async (sp: Record<string, string | string[] | undefined>) => {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const ctx = current.ctx;
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const view = parseRangeView(sp, today, await getEarliestKey(ctx));
  return { ctx, view, today };
});

async function load(
  searchParams: SearchParams,
): Promise<{ ctx: Ctx; view: RangeView; today: string }> {
  return resolve(await searchParams);
}

const pct = (bp: number | null) => (bp === null ? "—" : formatPercentBp(bp));

function Widget({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Error state: the rest of the dashboard keeps working. */
async function guarded(title: string, render: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await render();
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // redirect / notFound
    console.error(`Dashboard widget "${title}" failed`, err);
    return (
      <Widget title={title}>
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4" aria-hidden /> Could not load this card. Reload the page
          to try again.
        </p>
      </Widget>
    );
  }
}

function FxBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="outline" title="Add rates in Settings → FX rates">
      FX rate missing · {count} left out
    </Badge>
  );
}

export async function DashboardRangeBar({ searchParams }: { searchParams: SearchParams }) {
  const { view } = await load(searchParams);
  return <TimeRangeBar view={view} />;
}

export async function StandingCards({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Summary", async () => {
    const { ctx, view } = await load(searchParams);
    const s = await getStanding(ctx, view);
    const ccy = s.currency;
    const change = (c: typeof s.monthChange) => (
      <span className="tabular-nums">
        <Money valueMinor={c.deltaMinor} currency={ccy} signed colorNegative={false} />
        {c.pctBp !== null ? ` (${formatPercentBp(c.pctBp, { signed: true })})` : ""} this month
      </span>
    );
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_1.4fr]">
        <StatCard
          label="Net worth"
          value={<Money valueMinor={s.netWorthMinor} currency={ccy} compact />}
          hint={change(s.monthChange)}
        />
        <StatCard
          label="Assets"
          value={<Money valueMinor={s.assetsMinor} currency={ccy} compact />}
        />
        <StatCard
          label="Liabilities"
          value={
            <Money valueMinor={s.liabilitiesMinor} currency={ccy} compact colorNegative={false} />
          }
        />
        <StatCard
          label="Savings rate this month"
          value={pct(s.thisMonthSavingsRateBp)}
          hint="(income − expense) ÷ income"
        />
        <Card size="sm" aria-label="Standing summary">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Standing summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Net worth change</dt>
              <dd className="text-right tabular-nums">
                <Money
                  valueMinor={s.netWorthChange.deltaMinor}
                  currency={ccy}
                  signed
                  compact
                  colorNegative={false}
                />
              </dd>
              <dt className="text-muted-foreground">Savings rate</dt>
              <dd className="text-right tabular-nums">{pct(s.savingsRateBp)}</dd>
              <dt className="text-muted-foreground">Investment rate</dt>
              <dd className="text-right tabular-nums">{pct(s.investmentRateBp)}</dd>
              <dt className="text-muted-foreground">Runway</dt>
              <dd className="text-right tabular-nums">
                {s.runwayTenths === null ? "—" : `${(s.runwayTenths / 10).toFixed(1)} months`}
              </dd>
              <dt className="text-muted-foreground">Debt load</dt>
              <dd className="text-right">—</dd>
              <dt className="text-muted-foreground">Health score</dt>
              <dd className="text-right">—</dd>
            </dl>
            <FxBadge count={s.fxMissing} />
          </CardContent>
        </Card>
      </div>
    );
  });
}

export async function NetWorthCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Net worth trend", async () => {
    const { ctx, view } = await load(searchParams);
    const s = await netWorthSeries(ctx, view);
    return (
      <Widget
        title="Net worth trend"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              <Money
                valueMinor={s.change.deltaMinor}
                currency={s.currency}
                signed
                colorNegative={false}
              />
              {s.change.pctBp !== null
                ? ` (${formatPercentBp(s.change.pctBp, { signed: true })})`
                : ""}{" "}
              {view.compare ? "vs previous period" : "over this range"}
            </span>
            <FxBadge count={s.fxMissing} />
          </span>
        }
        action={<NetWorthMenu />}
      >
        <NetWorthChart
          points={s.points}
          currency={s.currency}
          granularity={view.granularity}
          compare={view.compare}
        />
      </Widget>
    );
  });
}

export async function AssetsLiabilitiesCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Assets vs liabilities", async () => {
    const { ctx, view } = await load(searchParams);
    const s = await netWorthSeries(ctx, view);
    return (
      <Widget title="Assets vs liabilities" description="Closing value of each period">
        <AssetsLiabilitiesChart
          points={s.points}
          currency={s.currency}
          granularity={view.granularity}
        />
      </Widget>
    );
  });
}

export async function AllocationCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Allocation", async () => {
    const { ctx, view } = await load(searchParams);
    const a = await allocationAsOf(ctx, view.range.to);
    return (
      <Widget
        title="Allocation"
        description={
          <span className="flex flex-wrap items-center gap-2">
            By asset class on {a.asOf} · <Money valueMinor={a.totalMinor} currency={a.currency} />
            <FxBadge count={a.fxMissing} />
          </span>
        }
      >
        <AllocationDonut allocation={a} />
      </Widget>
    );
  });
}

export async function CashflowCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Income vs expense", async () => {
    const { ctx, view } = await load(searchParams);
    const c = await cashflowSeries(ctx, view);
    return (
      <Widget
        title="Income vs expense"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Income <Money valueMinor={c.totals.incomeMinor} currency={c.currency} /> · Expense{" "}
              <Money valueMinor={c.totals.expenseMinor} currency={c.currency} /> · Savings rate{" "}
              {pct(c.totals.savingsRateBp)}
            </span>
            {c.expenseChange && c.expenseChange.pctBp !== null ? (
              <span>
                Expense {formatPercentBp(c.expenseChange.pctBp, { signed: true })} vs previous
                period
              </span>
            ) : null}
            <FxBadge count={c.fxMissing} />
          </span>
        }
      >
        <div className="grid gap-4">
          <CashflowChart points={c.points} currency={c.currency} granularity={view.granularity} />
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Savings rate</h3>
            <SavingsRateChart points={c.points} granularity={view.granularity} />
          </div>
        </div>
      </Widget>
    );
  });
}

export async function TopCategoriesCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Top expense categories", async () => {
    const { ctx, view } = await load(searchParams);
    const t = await topExpenseCategories(ctx, view.range);
    return (
      <Widget
        title="Top expense categories"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              <Money valueMinor={t.totalMinor} currency={t.currency} /> in this range
            </span>
            <FxBadge count={t.fxMissing} />
          </span>
        }
      >
        <TopCategoriesList data={t} from={view.range.from} to={view.range.to} />
      </Widget>
    );
  });
}

export async function CashCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Where my cash is", async () => {
    const { ctx } = await load(searchParams);
    const s = await getSafeToSpend(ctx);
    return (
      <Widget
        title="Where my cash is"
        description={
          <span className="flex flex-wrap items-center gap-2">
            Emergency, opportunity and free cash today
            <FxBadge count={s.fxMissing} />
          </span>
        }
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <BucketBar
            emergencyMinor={s.emergencyMinor}
            opportunityMinor={s.opportunityMinor}
            freeMinor={s.freeCashMinor}
            currency={s.currency}
          />
          <SafeToSpendValue data={s} />
        </div>
      </Widget>
    );
  });
}

export async function UpcomingCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Upcoming", async () => {
    const { ctx, today } = await load(searchParams);
    const until = utcToBusinessDate(new Date(Date.now() + 14 * 86_400_000), ctx.tz);
    const items = await getUpcoming(ctx, until);
    return (
      <Widget title="Upcoming (14 days)" description={`${today} – ${until}`}>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing due. SIPs, bills and EMIs show here once you set them up.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={i.href} className="flex min-w-0 items-center gap-2 hover:underline">
                  <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{i.title}</span>
                </Link>
                <span className="flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground tabular-nums">
                  {i.dueDate}
                  {i.amountMinor !== null ? (
                    <Money
                      valueMinor={i.amountMinor}
                      currency={i.currency}
                      className="text-sm text-foreground"
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    );
  });
}

export async function AttentionCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Attention", async () => {
    const { ctx } = await load(searchParams);
    const a = await getAttention(ctx);
    return (
      <Widget title="Attention">
        {a.staleCount === 0 && a.offTargetCount === 0 ? (
          <p className="text-sm text-muted-foreground">All caught up.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {a.staleCount > 0 ? (
              <li>
                <Link
                  href="/assets/update-values"
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span>
                    {a.staleCount} holding{a.staleCount === 1 ? "" : "s"} need a new value
                  </span>
                  <span className="text-muted-foreground">Update values →</span>
                </Link>
              </li>
            ) : null}
            {a.offTargetCount > 0 ? (
              <li>
                <Link
                  href="/rebalancing?tab=actual"
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span>
                    {a.offTargetCount} asset class{a.offTargetCount === 1 ? "" : "es"} off target
                  </span>
                  <span className="text-muted-foreground">Allocation →</span>
                </Link>
              </li>
            ) : null}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Budgets, opportunity-fund triggers and forecast warnings appear here in later phases.
        </p>
      </Widget>
    );
  });
}

export function LaterCard({ title, phase, text }: { title: string; phase: number; text: string }) {
  return (
    <Widget title={title}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Construction className="size-4" aria-hidden /> {text} (Phase {phase}).
      </p>
    </Widget>
  );
}
