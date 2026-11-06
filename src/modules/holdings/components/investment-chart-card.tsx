import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Money } from "@/components/shared/money";
import { TimeRangeBar } from "@/components/shared/time-range-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RangePreset } from "@/domain/date-range";
import { formatPercentBp } from "@/lib/format";
import { InvestmentChart } from "@/modules/holdings/components/investment-chart-lazy";
import { InvestmentScopeSelect } from "@/modules/holdings/components/investment-scope-select";
import { getInvestmentChart, type InvestmentScope } from "@/modules/holdings/queries";
import { getCurrentUser } from "@/server/auth/require-user";

// docs/04 §24 — "Invested vs value" on the Assets page and each holding's page.

const PRESETS = [
  ["30d", "1M"],
  ["3m", "3M"],
  ["6m", "6M"],
  ["ytd", "YTD"],
  ["1y", "1Y"],
  ["all", "All"],
] as const;

const tone = (v: number) =>
  v > 0 ? "text-emerald-700 dark:text-emerald-400" : v < 0 ? "text-destructive" : "";
const arrow = (v: number) => (v > 0 ? "▲ " : v < 0 ? "▼ " : "");

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums md:text-lg">{children}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const scopeValue = (s: InvestmentScope) => (s.kind === "all" ? "all" : `${s.kind}:${s.id}`);

export async function InvestmentChartCard({
  searchParams,
  scope,
  defaultPreset,
  excludeEmergency,
  title,
  description,
  filter = false,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  scope: InvestmentScope;
  defaultPreset: RangePreset;
  excludeEmergency?: boolean;
  title: string;
  description: string;
  /** Show the All / class / holding picker (Assets page). */
  filter?: boolean;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const c = await getInvestmentChart(current.ctx, {
    searchParams,
    scope,
    defaultPreset,
    excludeEmergency,
  });
  const { end, currency } = c;
  const inRange = c.view.preset === "all" ? "all time" : "this range";

  return (
    <Card className="mb-4 min-w-0" data-testid="investment-chart">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {filter ? (
          <InvestmentScopeSelect
            value={scopeValue(c.scope)}
            classes={c.options.classes}
            holdings={c.options.holdings}
          />
        ) : null}
      </CardHeader>
      {/* min-w-0 on every row: the range row scrolls sideways instead of widening the card. */}
      <CardContent className="grid gap-4 *:min-w-0">
        <TimeRangeBar view={c.view} presets={PRESETS} options={false} />
        <div className="-mt-4 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <Stat label="Value">
            <Money valueMinor={end.valueMinor} currency={currency} />
          </Stat>
          <Stat label="Invested">
            <Money valueMinor={end.investedMinor} currency={currency} />
          </Stat>
          <Stat
            label="Gain"
            hint={end.gainBp !== null ? formatPercentBp(end.gainBp, { signed: true }) : "—"}
          >
            <span className={tone(end.gainMinor)}>
              {arrow(end.gainMinor)}
              <Money valueMinor={end.gainMinor} currency={currency} signed colorNegative={false} />
            </span>
          </Stat>
          <Stat label={`Market gain in ${inRange}`} hint="Value change minus money added">
            <span className={tone(c.marketGainMinor)}>
              {arrow(c.marketGainMinor)}
              <Money
                valueMinor={c.marketGainMinor}
                currency={currency}
                signed
                colorNegative={false}
              />
            </span>
          </Stat>
        </div>
        <InvestmentChart points={c.points} currency={currency} label={title} />
        <p className="border-t border-dashed pt-3 text-sm text-muted-foreground">
          Dividends &amp; interest received in {inRange}:{" "}
          <span className="font-medium text-foreground">
            <Money valueMinor={c.incomeMinor} currency={currency} />
          </span>{" "}
          · paid to your accounts or reinvested, so not a line on the chart
        </p>
        {c.fxMissing > 0 ? (
          <p className="text-xs text-muted-foreground">
            {c.fxMissing} holding{c.fxMissing === 1 ? "" : "s"} left out: no exchange rate for that
            date. Add rates in Settings.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
