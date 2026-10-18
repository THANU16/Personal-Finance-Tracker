import Link from "next/link";
import { format, parseISO } from "date-fns";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClassDrift, DriftStatus } from "@/domain/drift";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { vizColor } from "@/lib/viz-palette";
import { TargetEditor } from "@/modules/allocation/components/target-editor";
import { RebalancePanel } from "@/modules/rebalancing/components/rebalance-panel";
import { getAllocationView, getTargetHistory } from "@/modules/rebalancing/service";
import { getCurrentUser } from "@/server/auth/require-user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const TABS = [
  ["plan", "Plan"],
  ["actual", "Planned vs Actual"],
  ["rebalance", "Rebalance"],
  ["history", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

function TabNav({ tab }: { tab: Tab }) {
  return (
    <nav
      aria-label="Allocation sections"
      className="mb-4 flex w-fit flex-wrap rounded-lg bg-muted p-0.5 text-sm"
    >
      {TABS.map(([key, label]) => (
        <Link
          key={key}
          href={key === "plan" ? "/rebalancing" : `/rebalancing?tab=${key}`}
          aria-current={tab === key ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1",
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

const STATUS: Record<DriftStatus, { label: string; icon: typeof Check; className: string }> = {
  ok: { label: "OK", icon: Check, className: "bg-muted text-foreground" },
  over: { label: "Over", icon: ArrowUp, className: "bg-[var(--viz-series-2)]/15 text-foreground" },
  under: {
    label: "Under",
    icon: ArrowDown,
    className: "bg-[var(--viz-series-1)]/15 text-foreground",
  },
};

function StatusChip({ status }: { status: DriftStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        s.className,
      )}
    >
      <s.icon className="size-3" aria-hidden /> {s.label}
    </span>
  );
}

/**
 * Drift gauge: target in the middle, the tolerance band (± threshold) shaded, a marker at the
 * drift. The value is always in text next to it (never colour alone).
 */
function DriftGauge({ driftBp, thresholdBp }: { driftBp: number; thresholdBp: number }) {
  const span = Math.max(thresholdBp * 2, Math.abs(driftBp) * 1.2, 100);
  const pos = (bp: number) => 50 + (Math.max(-span, Math.min(span, bp)) / span) * 50;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-32 rounded-full bg-muted" aria-hidden>
        <div
          className="absolute inset-y-0 bg-muted-foreground/20"
          style={{ left: `${pos(-thresholdBp)}%`, right: `${100 - pos(thresholdBp)}%` }}
        />
        <div className="absolute inset-y-[-2px] left-1/2 w-px bg-muted-foreground/60" />
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--card)] bg-foreground"
          style={{ left: `${pos(driftBp)}%` }}
        />
      </div>
      <span className="w-16 text-right text-xs tabular-nums">
        {formatPercentBp(driftBp, { signed: true })}
      </span>
    </div>
  );
}

/** /rebalancing content. Render inside <Suspense>. */
export async function AllocationContent({ searchParams }: { searchParams: SearchParams }) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx } = current;
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "plan";
  const view = await getAllocationView(ctx);
  const className = Object.fromEntries(view.options.classes.map((c) => [c.id, c.name]));
  const classColor = Object.fromEntries(view.options.classes.map((c) => [c.id, c.color]));
  const holdingNames = Object.fromEntries(
    view.holdings.map((h) => [h.id, { name: h.name, isFd: h.isFd }]),
  );
  const ccy = view.currency;
  const noTarget = view.target.allocation.length === 0;

  if (tab === "plan") {
    return (
      <>
        <TabNav tab={tab} />
        <TargetEditor target={view.target} options={view.options} />
      </>
    );
  }

  if (noTarget) {
    return (
      <>
        <TabNav tab={tab} />
        <p className="text-sm text-muted-foreground">
          Set your target allocation on the{" "}
          <Link href="/rebalancing" className="underline underline-offset-4">
            Plan
          </Link>{" "}
          tab first.
        </p>
      </>
    );
  }

  if (tab === "history") {
    const history = await getTargetHistory(ctx);
    return (
      <>
        <TabNav tab={tab} />
        <Card>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Target allocation history">
              {history.map((h) => (
                <li key={h.id} className="grid gap-1 py-3">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">
                      {format(parseISO(h.savedAt), "d MMM yyyy, HH:mm")}
                    </span>
                    {h.note ? <span className="text-muted-foreground">— {h.note}</span> : null}
                  </span>
                  <span className="text-muted-foreground">
                    {h.diff.classes.length === 0 &&
                    !h.diff.holdingsAdded.length &&
                    !h.diff.holdingsRemoved.length &&
                    h.diff.thresholdFromBp === null
                      ? "No changes"
                      : [
                          ...h.diff.classes.map((c) =>
                            c.fromBp === null
                              ? `+ ${className[c.assetClassId] ?? "Class"} ${formatPercentBp(c.toBp!)}`
                              : c.toBp === null
                                ? `− ${className[c.assetClassId] ?? "Class"}`
                                : `${className[c.assetClassId] ?? "Class"} ${formatPercentBp(c.fromBp)} → ${formatPercentBp(c.toBp)}`,
                          ),
                          ...h.diff.holdingsAdded.map(
                            (id) => `+ ${holdingNames[id]?.name ?? "holding"}`,
                          ),
                          ...h.diff.holdingsRemoved.map(
                            (id) => `− ${holdingNames[id]?.name ?? "holding"}`,
                          ),
                          ...(h.diff.thresholdFromBp !== null
                            ? [
                                `threshold ${formatPercentBp(h.diff.thresholdFromBp)} → ${formatPercentBp(h.thresholdBp)}`,
                              ]
                            : []),
                        ].join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </>
    );
  }

  if (tab === "rebalance") {
    return (
      <>
        <TabNav tab={tab} />
        <Card>
          <CardHeader>
            <CardTitle>Rebalance</CardTitle>
            <CardDescription>
              Based on today&apos;s values of{" "}
              <Money valueMinor={view.drift.universeValueMinor} currency={ccy} /> in your target
              classes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RebalancePanel
              currency={ccy}
              trades={view.trades}
              names={{ classes: className, holdings: holdingNames }}
              nextSips={view.nextSips}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const row = (c: ClassDrift) => (
    <tr key={c.assetClassId} className="border-t align-top">
      <td className="py-2 pr-3">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
            <span
              className="size-3 rounded-sm"
              style={{ background: vizColor(classColor[c.assetClassId] ?? "#6250d6") }}
              aria-hidden
            />
            {className[c.assetClassId] ?? "Asset class"}
          </summary>
          {c.assets.length ? (
            <ul className="mt-2 grid gap-1 pl-5 text-xs text-muted-foreground">
              {c.assets.map((a) => (
                <li key={a.holdingId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {holdingNames[a.holdingId]?.name ?? "Holding"}
                    {!a.inTarget && c.hasAssetTargets ? " (not in target)" : ""}
                  </span>
                  <span className="tabular-nums">
                    <Money valueMinor={a.valueMinor} currency={ccy} /> ·{" "}
                    {formatPercentBp(a.weightInClassBp)} of class
                    {a.targetInClassBp !== null
                      ? ` · target ${formatPercentBp(a.targetInClassBp)}`
                      : ""}
                    {a.driftBp !== null ? ` · ${formatPercentBp(a.driftBp, { signed: true })}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <Money valueMinor={c.valueMinor} currency={ccy} />
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatPercentBp(c.weightBp)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatPercentBp(c.targetBp)}</td>
      <td className="py-2 pr-3">
        <DriftGauge driftBp={c.driftBp} thresholdBp={view.target.thresholdBp} />
      </td>
      <td className="py-2">
        <StatusChip status={c.status} />
      </td>
    </tr>
  );

  return (
    <>
      <TabNav tab={tab} />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Planned vs actual
            {view.fxMissing > 0 ? (
              <Badge variant="outline">FX rate missing · {view.fxMissing} left out</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Tolerance band ± {formatPercentBp(view.target.thresholdBp)} (shaded). Emergency-fund
            holdings are not part of rebalancing
            {view.drift.excludedEmergencyMinor > 0 ? (
              <>
                {" "}
                (<Money valueMinor={view.drift.excludedEmergencyMinor} currency={ccy} /> left out)
              </>
            ) : null}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="pr-3 pb-2 text-left font-medium">
                  Class
                </th>
                <th scope="col" className="pr-3 pb-2 text-right font-medium">
                  Value
                </th>
                <th scope="col" className="pr-3 pb-2 text-right font-medium">
                  Current
                </th>
                <th scope="col" className="pr-3 pb-2 text-right font-medium">
                  Target
                </th>
                <th scope="col" className="pr-3 pb-2 text-left font-medium">
                  Drift
                </th>
                <th scope="col" className="pb-2 text-left font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>{view.drift.classes.map(row)}</tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">
                  <Money valueMinor={view.drift.universeValueMinor} currency={ccy} />
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
          {view.drift.outside.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Outside target:{" "}
              {view.drift.outside.map((o, i) => (
                <span key={o.assetClassId}>
                  {i ? " · " : ""}
                  {className[o.assetClassId] ?? "Class"}{" "}
                  <Money valueMinor={o.valueMinor} currency={ccy} />
                </span>
              ))}{" "}
              — add the class to your target to include it.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
