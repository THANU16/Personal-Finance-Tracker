import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format, parse } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { utcToBusinessDate } from "@/domain/dates";
import { vizColor } from "@/lib/viz-palette";
import { formatPercentBp, formatPrice, formatUnits } from "@/lib/format";
import { listAccounts } from "@/modules/accounts/service";
import { FdActions } from "@/modules/holdings/components/fd-actions";
import { GainCell, StaleBadge } from "@/modules/holdings/components/holdings-table";
import { HoldingHeaderActions, HoldingTabs } from "@/modules/holdings/components/holding-tabs";
import { INSTRUMENT_LABEL } from "@/modules/holdings/components/holding-meta";
import { ValueChart } from "@/modules/holdings/components/value-chart";
import {
  getHoldingDetail,
  listActiveClasses,
  type HoldingDetail as Detail,
} from "@/modules/holdings/queries";
import { getCurrentUser } from "@/server/auth/require-user";
import { getHoldingBuckets } from "@/modules/earmarks/holding-service";
import { EarmarksCard } from "@/modules/earmarks/components/earmarks-card";
import { AppError } from "@/server/errors";

const longDate = (key: string) =>
  format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

/** /assets/[id] content (docs/05 §5 holding detail). Render inside <Suspense>. */
export async function HoldingDetailView({ params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx, settings } = current;
  const { id } = await params;
  let detail: Detail;
  try {
    detail = await getHoldingDetail(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { holding: h, transactions, valuations, timeline } = detail;
  const todayKey = utcToBusinessDate(new Date(), ctx.tz);
  const [classes, accounts, buckets] = await Promise.all([
    listActiveClasses(ctx),
    h.fd ? listAccounts(ctx) : Promise.resolve([]),
    getHoldingBuckets(ctx, id),
  ]);
  const fd = h.fd;

  return (
    <>
      <Link
        href="/assets"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Assets
      </Link>
      <PageHeader
        title={h.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span
                className="size-2 rounded-full"
                style={{ background: vizColor(h.assetClass.color) }}
                aria-hidden
              />
              {h.assetClass.name}
            </span>
            · {INSTRUMENT_LABEL[h.instrumentType]}
            {h.platform ? ` · ${h.platform}` : ""}
            {h.status === "closed" ? <Badge variant="secondary">Closed</Badge> : null}
            {h.stale ? <StaleBadge days={h.daysSinceValued} /> : null}
          </span>
        }
        actions={
          <>
            <HoldingHeaderActions
              holding={h}
              todayKey={todayKey}
              bigChangeThresholdBp={settings.bigChangeThresholdBp}
            />
            {fd ? (
              <FdActions
                holding={h}
                accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
                todayKey={todayKey}
              />
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Value"
          value={<Money valueMinor={h.currentValueMinor} currency={h.currency} />}
          hint={
            h.trackUnits && h.units !== null
              ? `${formatUnits(h.units)} units${h.lastPriceMinorE4 ? ` × ${formatPrice(h.lastPriceMinorE4, h.currency)}` : ""}`
              : h.lastValuedAt
                ? `Valued ${longDate(h.lastValuedAt)}`
                : fd
                  ? "Calculated from the deposit terms"
                  : null
          }
        />
        <StatCard
          label="Unrealised gain"
          value={
            <GainCell minor={h.unrealizedGainMinor} bp={h.unrealizedBp} currency={h.currency} />
          }
          hint={
            <>
              Invested <Money valueMinor={h.investedMinor} currency={h.currency} />
            </>
          }
        />
        <StatCard
          label="XIRR"
          value={h.xirrBp !== null ? formatPercentBp(h.xirrBp) : "—"}
          hint={
            h.xirrBp === null
              ? "Shown after 90 days"
              : h.firstInvestedAt
                ? `Since ${longDate(h.firstInvestedAt)}`
                : null
          }
        />
        <StatCard
          label="Income & realised"
          value={
            <Money valueMinor={h.incomeReceivedMinor + h.realizedGainMinor} currency={h.currency} />
          }
          hint={
            <>
              Income <Money valueMinor={h.incomeReceivedMinor} currency={h.currency} /> · Realised{" "}
              <Money valueMinor={h.realizedGainMinor} currency={h.currency} />
            </>
          }
        />
      </div>

      {fd ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard
            label={fd.daysToMaturity > 0 ? "Matures in" : "Matured"}
            value={fd.daysToMaturity > 0 ? `${fd.daysToMaturity} days` : longDate(fd.maturityDate)}
            hint={`${formatPercentBp(fd.rateBp)} · ${fd.compounding} · ${longDate(fd.startDate)} → ${longDate(fd.maturityDate)}`}
          />
          <StatCard
            label="Accrued interest"
            value={<Money valueMinor={fd.accruedInterestMinor} currency={h.currency} />}
          />
          <StatCard
            label="Value at maturity"
            value={<Money valueMinor={fd.maturityValueMinor} currency={h.currency} />}
            hint={
              fd.payoutPerPeriodMinor ? (
                <>
                  Pays <Money valueMinor={fd.payoutPerPeriodMinor} currency={h.currency} />{" "}
                  {fd.payout}
                </>
              ) : null
            }
          />
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Value vs invested</CardTitle>
        </CardHeader>
        <CardContent>
          <ValueChart points={timeline} currency={h.currency} />
        </CardContent>
      </Card>

      {buckets.active ? (
        <div className="mb-4">
          <EarmarksCard accountName={h.name} buckets={buckets} />
        </div>
      ) : null}

      <HoldingTabs
        holding={h}
        transactions={transactions}
        valuations={valuations}
        classes={classes}
      />
    </>
  );
}
