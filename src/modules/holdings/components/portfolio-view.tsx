import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartPie, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { utcToBusinessDate } from "@/domain/dates";
import { formatPercentBp } from "@/lib/format";
import { vizColor } from "@/lib/viz-palette";
import { cn } from "@/lib/utils";
import { listAccounts } from "@/modules/accounts/service";
import {
  AddHoldingDialog,
  type AddHoldingOptions,
} from "@/modules/holdings/components/add-holding-dialog";
import { GainCell, HoldingsTable } from "@/modules/holdings/components/holdings-table";
import { getPortfolio, listActiveClasses } from "@/modules/holdings/queries";
import { getCurrentUser } from "@/server/auth/require-user";
import type { Ctx } from "@/server/ctx";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function addHoldingOptions(ctx: Ctx): Promise<AddHoldingOptions> {
  const [classes, accounts] = await Promise.all([listActiveClasses(ctx), listAccounts(ctx)]);
  return {
    classes,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    baseCurrency: ctx.baseCurrency,
    todayKey: utcToBusinessDate(new Date(), ctx.tz),
  };
}

/** Session-dependent header action. Render inside <Suspense>. */
export async function AddHoldingAction() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return <AddHoldingDialog options={await addHoldingOptions(current.ctx)} />;
}

function ViewLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1 text-sm",
        active
          ? "bg-background font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/** /assets content (docs/05 §5). Render inside <Suspense>. */
export async function PortfolioView({ searchParams }: { searchParams: SearchParams }) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx, settings } = current;
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "class";
  const showClosed = sp.closed === "1";
  // ?class=<id>: one class only (dashboard allocation donut links here).
  const classFilter = typeof sp.class === "string" ? sp.class : null;
  // ?emergency=hide: totals, weights and XIRR without emergency-fund holdings.
  const hideEmergency = sp.emergency === "hide";
  const p = await getPortfolio(ctx, { includeClosed: showClosed, excludeEmergency: hideEmergency });
  const todayKey = utcToBusinessDate(new Date(), ctx.tz);
  const t = p.totals;
  const param = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams({
      ...(view === "all" ? { view } : {}),
      ...(showClosed ? { closed: "1" } : {}),
      ...(classFilter ? { class: classFilter } : {}),
      ...(hideEmergency ? { emergency: "hide" } : {}),
    });
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `/assets?${s}` : "/assets";
  };

  if (p.holdings.length === 0 && p.closedCount === 0 && !hideEmergency) {
    return (
      <EmptyState
        icon={<ChartPie />}
        title="No holdings yet"
        description="Add each investment with what you put in and what it is worth today: unit trusts, shares, FDs, gold, crypto, property."
        action={
          <AddHoldingDialog options={await addHoldingOptions(ctx)} label="Add your first holding" />
        }
      />
    );
  }

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Value"
          value={<Money valueMinor={t.valueMinor} currency={t.currency} compact />}
        />
        <StatCard
          label="Invested"
          value={<Money valueMinor={t.investedMinor} currency={t.currency} compact />}
        />
        <StatCard
          label="Unrealised gain"
          value={
            <Money
              valueMinor={t.unrealizedGainMinor}
              currency={t.currency}
              compact
              signed={t.unrealizedGainMinor > 0}
            />
          }
          hint={t.unrealizedBp !== null ? formatPercentBp(t.unrealizedBp, { signed: true }) : null}
        />
        <StatCard
          label="Realised gain"
          value={<Money valueMinor={t.realizedGainMinor} currency={t.currency} compact />}
        />
        <StatCard
          label="Income received"
          value={<Money valueMinor={t.incomeMinor} currency={t.currency} compact />}
        />
        <StatCard
          label="Portfolio XIRR"
          value={t.xirrBp !== null ? formatPercentBp(t.xirrBp) : "—"}
          hint={t.xirrBp === null ? "Shown after 90 days of history" : "Annualised, incl. income"}
        />
      </div>
      {t.fxMissingCount > 0 || p.staleCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {t.fxMissingCount > 0 ? (
            <span className="flex items-center gap-2">
              <Badge variant="outline">FX rate missing</Badge>
              {t.fxMissingCount} holding{t.fxMissingCount === 1 ? "" : "s"} not in totals — add
              rates in Settings
            </span>
          ) : null}
          {p.staleCount > 0 ? (
            <span className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-amber-500/60 text-amber-700 dark:text-amber-400"
              >
                Stale
              </Badge>
              {p.staleCount} value{p.staleCount === 1 ? "" : "s"} older than {settings.staleDays}{" "}
              days
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                render={<Link href="/assets/update-values" />}
              >
                <RefreshCw aria-hidden /> Update values
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="View" className="inline-flex rounded-lg bg-muted p-1">
          <ViewLink href={param({ view: null })} active={view === "class"}>
            By class
          </ViewLink>
          <ViewLink href={param({ view: "all" })} active={view === "all"}>
            All holdings
          </ViewLink>
        </nav>
        {p.emergency.count > 0 ? (
          <nav
            aria-label="Emergency-fund holdings"
            className="inline-flex items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">Emergency fund</span>
            <span className="inline-flex rounded-lg bg-muted p-1">
              <ViewLink href={param({ emergency: null })} active={!hideEmergency}>
                Included
              </ViewLink>
              <ViewLink href={param({ emergency: "hide" })} active={hideEmergency}>
                Hidden
              </ViewLink>
            </span>
          </nav>
        ) : null}
        <Link
          href={param({ closed: showClosed ? null : "1" })}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          {showClosed
            ? "Hide closed"
            : p.closedCount
              ? `Show ${p.closedCount} closed`
              : "Show closed"}
        </Link>
      </div>

      {hideEmergency && p.emergency.count > 0 ? (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          {p.emergency.count} emergency-fund holding{p.emergency.count === 1 ? "" : "s"} (
          <Money valueMinor={p.emergency.valueMinor} currency={t.currency} />) left out of these
          totals, weights and XIRR ·{" "}
          <Link href={param({ emergency: null })} className="underline underline-offset-4">
            Include them
          </Link>
        </p>
      ) : null}
      {view === "all" ? (
        <HoldingsTable
          holdings={p.holdings}
          todayKey={todayKey}
          bigChangeThresholdBp={settings.bigChangeThresholdBp}
          showClass
        />
      ) : (
        <div className="grid gap-4">
          {classFilter ? (
            <p className="text-sm text-muted-foreground">
              Showing one asset class ·{" "}
              <Link href={param({ class: null })} className="underline underline-offset-4">
                Show all classes
              </Link>
            </p>
          ) : null}
          {p.classes
            .filter((cls) => !classFilter || cls.id === classFilter)
            .map((cls) => (
              <Card key={cls.id}>
                <CardHeader>
                  <details open className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-semibold">
                        <span
                          className="size-3 rounded-full"
                          style={{ background: vizColor(cls.color) }}
                          aria-hidden
                        />
                        {cls.name}
                        <span className="text-sm font-normal text-muted-foreground">
                          {cls.weightBp !== null ? formatPercentBp(cls.weightBp) : "—"} of portfolio
                        </span>
                      </span>
                      <span className="flex items-center gap-4 text-sm">
                        <Money
                          valueMinor={cls.valueMinor}
                          currency={t.currency}
                          className="font-semibold"
                        />
                        <GainCell minor={cls.unrealizedGainMinor} bp={null} currency={t.currency} />
                        <span className="text-muted-foreground">
                          XIRR {cls.xirrBp !== null ? formatPercentBp(cls.xirrBp) : "—"}
                        </span>
                      </span>
                    </summary>
                    <CardContent className="mt-4 px-0">
                      <HoldingsTable
                        holdings={cls.holdings}
                        todayKey={todayKey}
                        bigChangeThresholdBp={settings.bigChangeThresholdBp}
                      />
                    </CardContent>
                  </details>
                </CardHeader>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
