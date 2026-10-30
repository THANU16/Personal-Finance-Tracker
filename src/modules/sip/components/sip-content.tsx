import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Plus, Repeat } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ExecutionActions,
  HistoryFilters,
  PlanChartsView,
  UndoButton,
} from "@/modules/sip/components/sip-client";
import {
  getPlanCharts,
  getSipOverview,
  listHistory,
  listUpcomingExecutions,
  type ExecutionRow,
} from "@/modules/sip/queries";
import { historyFiltersSchema } from "@/modules/sip/schemas";
import { getCurrentUser } from "@/server/auth/require-user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const TABS = [
  ["planner", "Planner"],
  ["upcoming", "Upcoming"],
  ["history", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

const STATUS_STYLE: Record<string, string> = {
  done: "bg-[var(--viz-series-1)]/15 text-foreground",
  partial: "bg-[var(--viz-series-2)]/15 text-foreground",
  skipped: "bg-muted text-muted-foreground",
  missed: "bg-destructive/10 text-destructive",
  due: "bg-muted text-foreground",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}

function TabNav({ tab }: { tab: Tab }) {
  return (
    <nav
      aria-label="SIP sections"
      className="mb-4 flex w-fit rounded-lg bg-muted p-0.5 text-sm max-md:max-w-full max-md:overflow-x-auto"
    >
      {TABS.map(([key, label]) => (
        <Link
          key={key}
          href={key === "planner" ? "/sip" : `/sip?tab=${key}`}
          aria-current={tab === key ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 max-md:inline-flex max-md:min-h-11 max-md:shrink-0 max-md:items-center",
            tab === key
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

const FREQ = (p: { frequency: string; dayOfMonth: number | null; weekday: number | null }) =>
  p.frequency === "monthly"
    ? `Monthly · ${p.dayOfMonth === 31 ? "last day" : `day ${p.dayOfMonth}`}`
    : `Weekly · ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday ?? 1]}`;

/** /sip content (server). Render inside <Suspense>. */
export async function SipContent({ searchParams }: { searchParams: SearchParams }) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx } = current;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "upcoming" || sp.tab === "history" ? sp.tab : "planner";

  if (tab === "planner") {
    const cards = await getSipOverview(ctx);
    return (
      <>
        <TabNav tab={tab} />
        {cards.length === 0 ? (
          <EmptyState
            icon={<Repeat />}
            title="No SIP plans yet"
            description="Set up a monthly or weekly investment. It follows your target allocation unless you give it its own split."
            action={
              <Link href="/sip/plans/new" className={buttonVariants()}>
                <Plus aria-hidden /> New plan
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <Card key={c.plan.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <Link
                      href={`/sip/plans/${c.plan.id}`}
                      className="truncate hover:underline max-md:-my-3 max-md:py-3"
                    >
                      {c.plan.name}
                    </Link>
                    <Badge variant={c.plan.status === "active" ? "secondary" : "outline"}>
                      {c.plan.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    <Money valueMinor={c.plan.amountMinor} currency={c.plan.currency} /> ·{" "}
                    {FREQ(c.plan)} · {c.accountName}
                    {c.plan.allocationSource === "target" ? " · follows target" : " · custom split"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Next due</dt>
                    <dd className="text-right tabular-nums">
                      {c.nextDue ? (
                        <>
                          {c.nextDue.dueDate} ·{" "}
                          <Money
                            valueMinor={c.nextDue.plannedTotalMinor}
                            currency={c.plan.currency}
                          />
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                    <dt className="text-muted-foreground">Consistency</dt>
                    <dd className="text-right tabular-nums">
                      {c.consistencyBp === null ? "—" : formatPercentBp(c.consistencyBp)}
                    </dd>
                    <dt className="text-muted-foreground">Invested</dt>
                    <dd className="text-right">
                      <Money valueMinor={c.investedMinor} currency={c.plan.currency} />
                    </dd>
                    <dt className="text-muted-foreground">Estimated value</dt>
                    <dd className="text-right">
                      <Money valueMinor={c.estimatedValueMinor} currency={c.plan.currency} />
                    </dd>
                    <dt className="text-muted-foreground">XIRR</dt>
                    <dd className="text-right tabular-nums">
                      {c.xirrBp === null ? "—" : formatPercentBp(c.xirrBp)}
                    </dd>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {c.nextDue ? (
                      <ExecutionActions
                        id={c.nextDue.id}
                        label={`${c.plan.name} ${c.nextDue.dueDate}`}
                      />
                    ) : null}
                    <Link
                      href={`/sip?tab=history&plan=${c.plan.id}`}
                      className={buttonVariants({ size: "sm", variant: "ghost" })}
                    >
                      History
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </>
    );
  }

  if (tab === "upcoming") {
    const rows = await listUpcomingExecutions(ctx);
    const byPlan = new Map<string, ExecutionRow[]>();
    for (const r of rows) byPlan.set(r.planName, [...(byPlan.get(r.planName) ?? []), r]);
    return (
      <>
        <TabNav tab={tab} />
        {rows.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title="Nothing due"
            description="Periods appear here a week before they are due."
          />
        ) : (
          <div className="grid gap-4">
            {[...byPlan.entries()].map(([name, list]) => (
              <Card key={name}>
                <CardHeader>
                  <CardTitle>{name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y" aria-label={`${name} periods`}>
                    {list.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{r.dueDate}</span>
                          <StatusChip
                            status={r.overdue && r.status === "due" ? "missed" : r.status}
                          />
                          <Money valueMinor={r.plannedTotalMinor} currency={r.currency} />
                          {r.carryInMinor > 0 ? (
                            <span className="text-xs text-muted-foreground">(incl. carry-in)</span>
                          ) : null}
                        </span>
                        <ExecutionActions id={r.id} label={`${name} ${r.dueDate}`} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </>
    );
  }

  const filters = historyFiltersSchema.parse(sp);
  const [rows, overview] = await Promise.all([listHistory(ctx, filters), getSipOverview(ctx)]);
  const charts = filters.plan ? await getPlanCharts(ctx, filters.plan) : null;
  return (
    <>
      <TabNav tab={tab} />
      <div className="grid gap-4">
        <HistoryFilters plans={overview.map((c) => ({ id: c.plan.id, name: c.plan.name }))} />
        {charts ? (
          <Card>
            <CardHeader>
              <CardTitle>{overview.find((c) => c.plan.id === filters.plan)?.plan.name}</CardTitle>
              <CardDescription>
                Consistency{" "}
                {(() => {
                  const c = overview.find((x) => x.plan.id === filters.plan);
                  return c?.consistencyBp === null || !c ? "—" : formatPercentBp(c.consistencyBp);
                })()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlanChartsView charts={charts} />
            </CardContent>
          </Card>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No periods match these filters.</p>
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y" aria-label="SIP history">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.planName}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {r.periodKey} · due {r.dueDate}
                      </span>
                      <StatusChip status={r.status} />
                      {r.onTime === false ? (
                        <span className="text-xs text-muted-foreground">late</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span>
                        <Money valueMinor={r.actualTotalMinor} currency={r.currency} /> /{" "}
                        <Money valueMinor={r.plannedTotalMinor} currency={r.currency} />
                      </span>
                      {r.status === "done" || r.status === "partial" || r.status === "skipped" ? (
                        <UndoButton
                          id={r.id}
                          label={`${r.planName} ${r.periodKey}`}
                          skipped={r.status === "skipped"}
                        />
                      ) : r.status === "due" || r.status === "missed" ? (
                        <ExecutionActions id={r.id} label={`${r.planName} ${r.periodKey}`} />
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
