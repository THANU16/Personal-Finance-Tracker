import Link from "next/link";
import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import {
  CalendarClock,
  CircleAlert,
  CreditCard,
  Landmark,
  PiggyBank,
  RefreshCw,
  Repeat,
  Scale,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import {
  AllocationDonut,
  AssetsLiabilitiesChart,
  CashflowChart,
  NetWorthChart,
  NetWorthSparkline,
  SavingsRateChart,
  TopCategoriesList,
} from "@/components/charts/dashboard-charts";
import { BucketBar } from "@/components/shared/bucket-bar";
import { HideAmountsToggle } from "@/components/shared/hide-amounts";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { TimeRangeBar } from "@/components/shared/time-range-bar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseRangeView, type RangeView } from "@/domain/date-range";
import { utcToBusinessDate } from "@/domain/dates";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  type UpcomingItem,
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

/** One net worth series per request: the phone hero sparkline and the trend chart share it. */
const seriesOf = cache((ctx: Ctx, view: RangeView) => netWorthSeries(ctx, view));

/** "▲ +LKR 289,330 (+3.8%) this month" — gains green, losses red, the arrow says it too. */
function ChangeChip({
  deltaMinor,
  pctBp,
  currency,
}: {
  deltaMinor: number;
  pctBp: number | null;
  currency: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit flex-wrap items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm tabular-nums",
        deltaMinor < 0
          ? "text-destructive"
          : deltaMinor > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground",
      )}
    >
      {deltaMinor > 0 ? "▲" : deltaMinor < 0 ? "▼" : ""}
      <Money valueMinor={deltaMinor} currency={currency} signed colorNegative={false} />
      {pctBp !== null ? ` (${formatPercentBp(pctBp, { signed: true })})` : ""}
      <span className="text-muted-foreground">this month</span>
    </span>
  );
}

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
    const [s, series] = await Promise.all([getStanding(ctx, view), seriesOf(ctx, view)]);
    const ccy = s.currency;
    const change = (c: typeof s.monthChange) => (
      <span className="tabular-nums">
        <Money valueMinor={c.deltaMinor} currency={ccy} signed colorNegative={false} />
        {c.pctBp !== null ? ` (${formatPercentBp(c.pctBp, { signed: true })})` : ""} this month
      </span>
    );
    const summary = (
      <>
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
          <dd className="text-right tabular-nums">{pct(s.debtLoadBp)}</dd>
        </dl>
        {s.healthScore ? (
          <Link
            href="/essentials"
            className="mt-2 flex flex-wrap items-center gap-2 text-xs hover:underline"
          >
            <Badge variant="secondary">Health {s.healthScore.score}/100</Badge>
            <span className="text-muted-foreground">
              {s.healthScore.reasons.length ? s.healthScore.reasons.join(" · ") : "All parts full"}
            </span>
          </Link>
        ) : null}
        <FxBadge count={s.fxMissing} />
      </>
    );
    const compact = (label: string, value: ReactNode) => (
      <div className="min-w-0 rounded-xl border bg-card p-3">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-base font-semibold tabular-nums">{value}</div>
      </div>
    );
    return (
      <>
        {/* Phones (docs/07 §5 Home): net worth hero, mini trend, compact strip, details folded. */}
        <div className="grid gap-3 md:hidden">
          <Card size="sm" aria-label="Net worth">
            <CardContent className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Net worth</span>
                <HideAmountsToggle className="-my-2 -mr-2" />
              </div>
              <div className="text-3xl font-semibold tracking-tight tabular-nums">
                <Money valueMinor={s.netWorthMinor} currency={ccy} />
              </div>
              <ChangeChip
                deltaMinor={s.monthChange.deltaMinor}
                pctBp={s.monthChange.pctBp}
                currency={ccy}
              />
              <NetWorthSparkline
                points={series.points}
                label={`Net worth trend over ${series.points.length} periods`}
              />
            </CardContent>
          </Card>
          <div className="grid grid-cols-3 gap-2">
            {compact("Assets", <Money valueMinor={s.assetsMinor} currency={ccy} compact />)}
            {compact(
              "Liabilities",
              <Money
                valueMinor={s.liabilitiesMinor}
                currency={ccy}
                compact
                colorNegative={false}
              />,
            )}
            {compact("Savings rate", pct(s.thisMonthSavingsRateBp))}
          </div>
          <details className="rounded-xl border bg-card">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-muted-foreground">
              More numbers
            </summary>
            <div className="px-4 pb-4">{summary}</div>
          </details>
        </div>
        <div className="hidden gap-3 sm:grid-cols-2 md:grid xl:grid-cols-[repeat(4,minmax(0,1fr))_1.4fr]">
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
            <CardContent>{summary}</CardContent>
          </Card>
        </div>
      </>
    );
  });
}

export async function NetWorthCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Net worth trend", async () => {
    const { ctx, view } = await load(searchParams);
    const s = await seriesOf(ctx, view);
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
    const s = await seriesOf(ctx, view);
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
            Investments by asset class on {a.asOf} ·{" "}
            <Money valueMinor={a.totalMinor} currency={a.currency} />
            <FxBadge count={a.fxMissing} />
          </span>
        }
      >
        <AllocationDonut allocation={a} />
        {a.reservedMinor > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Not shown: <Money valueMinor={a.reservedMinor} currency={a.currency} /> of emergency
            &amp; opportunity money held in assets.
          </p>
        ) : null}
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
        {a.staleCount === 0 &&
        a.offTargetCount === 0 &&
        !a.opportunity &&
        !a.forecast &&
        a.budgets.warn + a.budgets.over === 0 ? (
          <p className="text-sm text-muted-foreground">All caught up.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {a.forecast ? (
              <li>
                <Link
                  href="/forecast"
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span className="flex items-center gap-1.5">
                    <CircleAlert className="size-4 text-destructive" aria-hidden />
                    {a.forecast.name}{" "}
                    {a.forecast.below === "zero" ? "goes below zero" : "drops below your minimum"}{" "}
                    on {a.forecast.date}
                  </span>
                  <span className="text-muted-foreground">Forecast →</span>
                </Link>
              </li>
            ) : null}
            {a.opportunity ? (
              <li>
                <Link
                  href="/opportunity-fund"
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span>
                    Market down {formatPercentBp(a.opportunity.drawdownBp)}: deploy{" "}
                    <Money
                      valueMinor={a.opportunity.amountMinor}
                      currency={a.opportunity.currency}
                    />
                  </span>
                  <span className="text-muted-foreground">Opportunity fund →</span>
                </Link>
              </li>
            ) : null}
            {a.budgets.warn + a.budgets.over > 0 ? (
              <li>
                <Link
                  href="/budgets"
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span>
                    {a.budgets.over ? `${a.budgets.over} over budget` : ""}
                    {a.budgets.over && a.budgets.warn ? " · " : ""}
                    {a.budgets.warn ? `${a.budgets.warn} at 80% or more` : ""}
                  </span>
                  <span className="text-muted-foreground">Budgets →</span>
                </Link>
              </li>
            ) : null}
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
      </Widget>
    );
  });
}

interface AttentionRow {
  key: string;
  icon: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  href: string;
  action: string;
  /** The main thing to do (e.g. Execute a due SIP): a filled button. */
  primary?: boolean;
  urgent?: boolean;
}

const UPCOMING_ICON: Record<UpcomingItem["kind"], LucideIcon> = {
  sip: CalendarClock,
  recurring: Repeat,
  card_due: CreditCard,
  emi: Landmark,
  fd_maturity: PiggyBank,
};

/** The button on a due item: it opens the page that already does that action. */
function upcomingAction(i: UpcomingItem): string {
  if (i.kind === "sip") return i.href.startsWith("/sip/execute/") ? "Execute" : "View";
  if (i.kind === "recurring") return "Confirm";
  if (i.kind === "card_due" || i.kind === "emi") return "Pay";
  return "View";
}

/**
 * Phones only (docs/07 §5 Home): one "Needs attention" stack under the hero — due SIPs, bills and
 * EMIs (14 days) plus alerts, each with its action button. Desktop keeps Upcoming and Attention.
 */
export async function NeedsAttentionCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Needs attention", async () => {
    const { ctx } = await load(searchParams);
    const until = utcToBusinessDate(new Date(Date.now() + 14 * 86_400_000), ctx.tz);
    const [items, a] = await Promise.all([getUpcoming(ctx, until), getAttention(ctx)]);

    const rows: AttentionRow[] = [];
    if (a.forecast) {
      rows.push({
        key: "forecast",
        icon: CircleAlert,
        urgent: true,
        title: `${a.forecast.name} ${
          a.forecast.below === "zero" ? "goes below zero" : "drops below your minimum"
        }`,
        meta: `on ${a.forecast.date}`,
        href: "/forecast",
        action: "View",
      });
    }
    if (a.opportunity) {
      rows.push({
        key: "opportunity",
        icon: TrendingDown,
        title: `Market down ${formatPercentBp(a.opportunity.drawdownBp)}`,
        meta: (
          <>
            Deploy{" "}
            <Money valueMinor={a.opportunity.amountMinor} currency={a.opportunity.currency} />
          </>
        ),
        href: "/opportunity-fund",
        action: "Deploy",
      });
    }
    for (const i of items) {
      rows.push({
        key: `u-${i.id}`,
        icon: UPCOMING_ICON[i.kind],
        title: i.title,
        meta: (
          <>
            {i.dueDate}
            {i.amountMinor !== null ? (
              <>
                {" · "}
                <Money valueMinor={i.amountMinor} currency={i.currency} />
              </>
            ) : null}
          </>
        ),
        href: i.href,
        action: upcomingAction(i),
        primary: upcomingAction(i) === "Execute",
      });
    }
    if (a.budgets.warn + a.budgets.over > 0) {
      rows.push({
        key: "budgets",
        icon: PiggyBank,
        urgent: a.budgets.over > 0,
        title: [
          a.budgets.over ? `${a.budgets.over} over budget` : "",
          a.budgets.warn ? `${a.budgets.warn} at 80% or more` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        href: "/budgets",
        action: "Review",
      });
    }
    if (a.staleCount > 0) {
      rows.push({
        key: "stale",
        icon: RefreshCw,
        title: `${a.staleCount} holding${a.staleCount === 1 ? "" : "s"} need a new value`,
        href: "/assets/update-values",
        action: "Update",
      });
    }
    if (a.offTargetCount > 0) {
      rows.push({
        key: "drift",
        icon: Scale,
        title: `${a.offTargetCount} asset class${a.offTargetCount === 1 ? "" : "es"} off target`,
        href: "/rebalancing?tab=actual",
        action: "Review",
      });
    }

    return (
      <Widget title="Needs attention" description="Due in the next 14 days and alerts">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">All caught up.</p>
        ) : (
          <ul className="-mx-4 divide-y">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-4 py-2.5">
                <r.icon
                  className={cn(
                    "size-5 shrink-0",
                    r.urgent ? "text-destructive" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  {r.meta ? (
                    <div className="truncate text-xs text-muted-foreground tabular-nums">
                      {r.meta}
                    </div>
                  ) : null}
                </div>
                <Link
                  href={r.href}
                  className={buttonVariants({
                    variant: r.primary ? "default" : "outline",
                    size: "sm",
                  })}
                >
                  {r.action}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    );
  });
}

export async function OpportunityCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Opportunity fund", async () => {
    const { ctx } = await load(searchParams);
    const { getOpportunityOverview } = await import("@/modules/opportunity-fund/service");
    const o = await getOpportunityOverview(ctx);
    const target = o.settings.targetSizeMinor;
    const pct =
      target && target > 0
        ? Math.min(10_000, Math.round((o.fundBalanceMinor * 10_000) / target))
        : null;
    return (
      <Widget title="Opportunity fund">
        <div className="space-y-2 text-sm">
          <p className="text-xl font-semibold">
            <Money valueMinor={o.fundBalanceMinor} currency={o.baseCurrency} />
          </p>
          {pct !== null ? (
            <div>
              <div className="h-2 rounded-full bg-muted" aria-hidden>
                <div
                  className="h-2 rounded-full bg-[var(--viz-series-2)]"
                  style={{ width: `${pct / 100}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatPercentBp(pct)} of <Money valueMinor={target!} currency={o.baseCurrency} />{" "}
                target
              </p>
            </div>
          ) : null}
          <p className="text-muted-foreground">
            {o.cycle.latest
              ? `${o.settings.benchmarkName} ${o.cycle.drawdownBp ? `−${formatPercentBp(o.cycle.drawdownBp)}` : "at its high"} from the high`
              : `Add ${o.settings.benchmarkName} levels to track drawdown`}
          </p>
          <Link href="/opportunity-fund" className="text-sm text-primary hover:underline">
            {o.suggestion.amountMinor > 0 ? "Deploy now →" : "Open →"}
          </Link>
        </div>
      </Widget>
    );
  });
}

export async function GoalsCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Goals", async () => {
    const { ctx } = await load(searchParams);
    const { listGoals } = await import("@/modules/goals/service");
    const goals = (await listGoals(ctx)).goals.filter((g) => !g.archived).slice(0, 3);
    return (
      <Widget title="Goals">
        {goals.length ? (
          <ul className="space-y-3 text-sm">
            {goals.map((g) => (
              <li key={g.id}>
                <div className="flex justify-between gap-2">
                  <span className="truncate">{g.name}</span>
                  <span className="text-muted-foreground">
                    {formatPercentBp(g.progressBp)}
                    {g.status === "off_track"
                      ? " · off track"
                      : g.status === "achieved"
                        ? " · achieved"
                        : ""}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-2 rounded-full bg-[var(--viz-series-1)]"
                    style={{ width: `${g.progressBp / 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No goals yet.</p>
        )}
        <Link href="/goals" className="mt-3 inline-block text-sm text-primary hover:underline">
          {goals.length ? "All goals →" : "Add a goal →"}
        </Link>
      </Widget>
    );
  });
}

const TONE_BAR = { red: "bg-destructive", amber: "bg-amber-500", green: "bg-emerald-600" } as const;

/** docs/05 §2 row 5 — Essentials mini: emergency months and health score. */
export async function EssentialsCard({ searchParams }: { searchParams: SearchParams }) {
  return guarded("Essentials", async () => {
    const { ctx } = await load(searchParams);
    const { getEssentials } = await import("@/modules/essentials/service");
    const e = await getEssentials(ctx);
    const ef = e.emergency;
    return (
      <Widget title="Essentials">
        <div className="space-y-3 text-sm">
          <div>
            <div className="flex justify-between gap-2">
              <span>Emergency fund</span>
              <span className="text-muted-foreground">
                {ef.coverageTenths === null ? "—" : `${(ef.coverageTenths / 10).toFixed(1)} months`}{" "}
                · {formatPercentBp(ef.progressBp)}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden>
              <div
                className={`h-2 rounded-full ${TONE_BAR[ef.tone]}`}
                style={{ width: `${ef.progressBp / 100}%` }}
              />
            </div>
          </div>
          <p>
            Health score <span className="text-lg font-semibold">{e.score.score}</span>
            <span className="text-muted-foreground">/100</span>
          </p>
          {e.score.reasons.length ? (
            <p className="text-xs text-muted-foreground">
              {e.score.reasons.map((r) => r.text).join(" · ")}
            </p>
          ) : null}
          <Link href="/essentials" className="text-sm text-primary hover:underline">
            Essentials →
          </Link>
        </div>
      </Widget>
    );
  });
}
