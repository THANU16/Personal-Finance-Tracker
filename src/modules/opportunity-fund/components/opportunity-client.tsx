"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { TrendingDown, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TreeOptions } from "@/modules/allocation/schemas";
import {
  addMarketLevelAction,
  deleteMarketLevelAction,
  undoDeploymentAction,
} from "@/modules/opportunity-fund/actions";
import { DeployDialog } from "@/modules/opportunity-fund/components/deploy-dialog";
import { FundSettings } from "@/modules/opportunity-fund/components/fund-settings";
import { LevelsChart } from "@/modules/opportunity-fund/components/levels-chart";
import type { OpportunityOverviewDTO } from "@/modules/opportunity-fund/schemas";

const fmtLevel = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDate = (d: string) => format(parseISO(d), "d MMM yyyy");

/** Drawdown gauge: bar to the deepest rule, with a tick per rule and labels in ink. */
function DrawdownGauge({
  drawdownBp,
  rules,
  triggered,
}: {
  drawdownBp: number;
  rules: { drawdownBp: number }[];
  triggered: number[];
}) {
  const scale = Math.max(drawdownBp, ...rules.map((r) => r.drawdownBp)) * 1.1 || 1;
  return (
    <div className="mt-2" aria-hidden>
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--viz-series-2)]"
          style={{ width: `${Math.min(100, (drawdownBp / scale) * 100)}%` }}
        />
        {rules.map((r, i) => (
          <span
            key={r.drawdownBp}
            className={cn(
              "absolute -top-1 h-4 w-0.5",
              triggered.includes(i) ? "bg-foreground" : "bg-muted-foreground/50",
            )}
            style={{ left: `${(r.drawdownBp / scale) * 100}%` }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-muted-foreground">
        {rules.map((r) => (
          <span
            key={r.drawdownBp}
            className="absolute -translate-x-1/2"
            style={{ left: `${(r.drawdownBp / scale) * 100}%` }}
          >
            −{formatPercentBp(r.drawdownBp)}
          </span>
        ))}
      </div>
    </div>
  );
}

function AddLevelForm({ todayKey, benchmarkName }: { todayKey: string; benchmarkName: string }) {
  const router = useRouter();
  const [date, setDate] = useState<string | null>(todayKey);
  const [level, setLevel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(level.replace(/,/g, ""));
    start(async () => {
      const res = await addMarketLevelAction({ date, level: level.trim() ? value : Number.NaN });
      if (!res.ok) {
        setError(
          res.error.fieldErrors?.level?.[0] ??
            res.error.fieldErrors?.date?.[0] ??
            res.error.message,
        );
        return;
      }
      setError(null);
      setLevel("");
      setDate(todayKey);
      toast.success("Level saved");
      router.refresh();
    });
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
      noValidate
    >
      <FormField id="lvl-date" label="Date">
        <DatePicker id="lvl-date" value={date} onChange={setDate} />
      </FormField>
      <FormField id="lvl-value" label={`${benchmarkName} level`} error={error ?? undefined}>
        <Input
          id="lvl-value"
          inputMode="decimal"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        />
      </FormField>
      <Button type="submit" disabled={pending}>
        Add level
      </Button>
    </form>
  );
}

export function OpportunityClient({
  data,
  treeOptions,
  accounts,
}: {
  data: OpportunityOverviewDTO;
  treeOptions: TreeOptions;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [deployOpen, setDeployOpen] = useState(false);
  const [, start] = useTransition();
  const c = data.cycle;
  const ccy = data.baseCurrency;
  const s = data.suggestion;
  const rule = s.ruleIdx !== null ? data.settings.rules[s.ruleIdx] : undefined;
  const targetPct =
    data.settings.targetSizeMinor && data.settings.targetSizeMinor > 0
      ? Math.round((data.fundBalanceMinor * 10_000) / data.settings.targetSizeMinor)
      : null;

  return (
    <div className="space-y-6">
      {s.amountMinor > 0 && rule ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--viz-series-2)]/50 bg-[var(--viz-series-2)]/5 px-4 py-3"
        >
          <p className="flex items-center gap-2 text-sm">
            <TrendingDown className="size-5" aria-hidden />
            <span>
              <span className="font-medium">Market drop detected</span> — rule −
              {formatPercentBp(rule.drawdownBp)} reached. Suggested deployment{" "}
              <Money valueMinor={s.amountMinor} currency={ccy} />
            </span>
          </p>
          <Button onClick={() => setDeployOpen(true)}>Record deployment</Button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Fund balance"
          value={<Money valueMinor={data.fundBalanceMinor} currency={ccy} />}
          hint={
            data.settings.targetSizeMinor ? (
              <>
                {formatPercentBp(targetPct ?? 0)} of{" "}
                <Money valueMinor={data.settings.targetSizeMinor} currency={ccy} /> target
              </>
            ) : (
              "Opportunity earmarks + Opportunity Fund accounts"
            )
          }
        />
        <StatCard
          label={`${data.settings.benchmarkName} latest`}
          value={c.latest ? fmtLevel(c.latest.level) : "—"}
          hint={c.latest ? fmtDate(c.latest.date) : "Add a level below"}
        />
        <StatCard
          label="Reference high"
          value={c.referenceHigh ? fmtLevel(c.referenceHigh) : "—"}
          hint={
            c.referenceHighDate
              ? `Since ${fmtDate(c.referenceHighDate)} (cycle start)`
              : "Set by the first level"
          }
        />
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current drawdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">
              {c.latest ? `−${formatPercentBp(c.drawdownBp)}` : "—"}
            </div>
            <DrawdownGauge
              drawdownBp={c.drawdownBp}
              rules={data.settings.rules}
              triggered={c.triggered}
            />
            <p className="text-xs text-muted-foreground">
              {c.triggered.length
                ? `${c.triggered.length} rule${c.triggered.length === 1 ? "" : "s"} reached this cycle`
                : "No rule reached this cycle"}
              {c.deployedThisCycleMinor ? (
                <>
                  {" "}
                  · deployed <Money valueMinor={c.deployedThisCycleMinor} currency={ccy} />
                </>
              ) : null}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Market levels</CardTitle>
              <CardDescription>
                Enter {data.settings.benchmarkName} closes by hand. A new high starts a new cycle.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => setDeployOpen(true)}>
              Record deployment
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <AddLevelForm todayKey={data.todayKey} benchmarkName={data.settings.benchmarkName} />
            <LevelsChart
              levels={data.levels}
              referenceHigh={c.referenceHigh}
              rules={data.settings.rules}
              benchmarkName={data.settings.benchmarkName}
            />
            {data.levels.length ? (
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  All levels ({data.levels.length})
                </summary>
                <ul className="mt-2 divide-y text-sm">
                  {[...data.levels].reverse().map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="tabular-nums">
                        {fmtDate(l.date)} · {fmtLevel(l.level)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete level of ${fmtDate(l.date)}`}
                        onClick={() =>
                          start(async () => {
                            const res = await deleteMarketLevelAction(l.id);
                            if (!res.ok) toast.error(res.error.message);
                            else router.refresh();
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rules & allocation</CardTitle>
            <CardDescription>How much to deploy at each drop, and where it goes.</CardDescription>
          </CardHeader>
          <CardContent>
            <FundSettings data={data} treeOptions={treeOptions} accounts={accounts} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deployment history</CardTitle>
        </CardHeader>
        <CardContent>
          {data.deployments.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">From</th>
                    <th className="py-2 pr-3 font-medium">Drop</th>
                    <th className="py-2 pr-3 font-medium">Into</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.deployments.map((d) => (
                    <tr
                      key={d.id}
                      className={cn("border-t", d.status === "undone" && "text-muted-foreground")}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(d.date)}</td>
                      <td className="py-2 pr-3">{d.sourceAccount}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {d.drawdownBpAtDeploy ? `−${formatPercentBp(d.drawdownBpAtDeploy)}` : "—"}
                      </td>
                      <td className="py-2 pr-3">{d.lines.map((l) => l.holding).join(", ")}</td>
                      <td className="py-2 pr-3 text-right">
                        <Money valueMinor={d.amountMinor} currency={d.currency} />
                        {d.feeMinor ? (
                          <span className="block text-xs text-muted-foreground">
                            + fees <Money valueMinor={d.feeMinor} currency={d.currency} />
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">
                        {d.status === "undone" ? (
                          <Badge variant="secondary">Undone</Badge>
                        ) : (
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="sm">
                                <Undo2 aria-hidden /> Undo
                              </Button>
                            }
                            title="Undo this deployment?"
                            description={
                              <>
                                Voids {d.lines.length} investment{d.lines.length === 1 ? "" : "s"}{" "}
                                and returns{" "}
                                <Money
                                  valueMinor={d.amountMinor + d.feeMinor}
                                  currency={d.currency}
                                />{" "}
                                to {d.sourceAccount}, back into its opportunity money.
                              </>
                            }
                            confirmLabel="Undo deployment"
                            destructive
                            onConfirm={async () => {
                              const res = await undoDeploymentAction(d.id);
                              if (!res.ok) {
                                toast.error(res.error.message);
                                return false;
                              }
                              toast.success("Deployment undone");
                              router.refresh();
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No deployments yet.</p>
          )}
        </CardContent>
      </Card>

      {deployOpen ? (
        <DeployDialog
          open={deployOpen}
          onOpenChange={setDeployOpen}
          data={data}
          treeOptions={treeOptions}
        />
      ) : null}
    </div>
  );
}
