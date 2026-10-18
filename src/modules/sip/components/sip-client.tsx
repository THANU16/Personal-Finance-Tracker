"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { skipSipAction, undoSipAction } from "@/modules/sip/actions";
import type { PlanCharts } from "@/modules/sip/queries";

/** Execute (link) + Skip (with a reason) for a due or missed period. */
export function ExecutionActions({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function skip() {
    setPending(true);
    const result = await skipSipAction(id, { reason });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Period skipped");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        render={<Link href={`/sip/execute/${id}`} />}
        aria-label={`Execute ${label}`}
      >
        Execute
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Skip ${label}`}
      >
        Skip
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skip {label}?</DialogTitle>
            <DialogDescription>
              Nothing is invested and no transaction is recorded. You can undo this from History.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`skip-reason-${id}`}>Reason</Label>
            <Input
              id={`skip-reason-${id}`}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Short this month"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void skip()} disabled={pending || !reason.trim()}>
              {pending ? "Skipping…" : "Skip period"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function UndoButton({
  id,
  label,
  skipped,
}: {
  id: string;
  label: string;
  skipped: boolean;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="outline" aria-label={`Undo ${label}`}>
          Undo
        </Button>
      }
      title={`Undo ${label}?`}
      description={
        skipped
          ? "The period goes back to due (or missed if it is past its grace period)."
          : "Every investment of this execution is voided: the account balance and the holdings return to where they were. The period goes back to due (or missed)."
      }
      confirmLabel="Undo"
      destructive
      onConfirm={async () => {
        const result = await undoSipAction(id);
        if (!result.ok) {
          toast.error(result.error.message);
          return false;
        }
        toast.success("Undone");
        router.refresh();
      }}
    />
  );
}

/** History filters kept in the URL (?tab=history&plan=&status=). */
export function HistoryFilters({ plans }: { plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const planItems = [
    { value: "all", label: "All plans" },
    ...plans.map((p) => ({ value: p.id, label: p.name })),
  ];
  const statusItems = [
    { value: "all", label: "All statuses" },
    ...["due", "done", "partial", "skipped", "missed"].map((s) => ({
      value: s,
      label: s[0]!.toUpperCase() + s.slice(1),
    })),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={params.get("plan") ?? "all"}
        onValueChange={(v) => set("plan", v === "all" ? null : v)}
        items={planItems}
      >
        <SelectTrigger aria-label="Filter by plan" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {planItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={params.get("status") ?? "all"}
        onValueChange={(v) => set("status", v === "all" ? null : v)}
        items={statusItems}
      >
        <SelectTrigger aria-label="Filter by status" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const S1 = "var(--viz-series-1)";
const S2 = "var(--viz-series-2)";

/** Per-plan charts: cumulative invested (with today's estimated value) · planned vs actual per period. */
export function PlanChartsView({ charts }: { charts: PlanCharts }) {
  const ccy = charts.currency;
  if (charts.periods.length === 0) return <NoData>No periods due yet.</NoData>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Cumulative invested vs estimated value</h3>
        {charts.cumulative.length === 0 ? (
          <NoData>Nothing executed yet.</NoData>
        ) : (
          <ChartFrame
            label="Cumulative invested"
            summary={`Invested ${formatMoney(charts.investedMinor, ccy)}; estimated value today ${formatMoney(charts.estimatedValueMinor, ccy)}.`}
            legend={[
              { label: "Invested", color: S1 },
              { label: "Estimated value today", color: S2, shape: "dash" },
            ]}
            rows={charts.cumulative}
            columns={[
              { label: "Date", value: (r) => r.date },
              {
                label: "Invested",
                numeric: true,
                value: (r) => <Amount minor={r.investedMinor} currency={ccy} />,
              },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.cumulative} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  {...AXIS}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={16}
                />
                <YAxis tickFormatter={moneyTick(ccy)} {...AXIS} axisLine={false} width={88} />
                <Tooltip
                  content={({ active, payload }) => {
                    const r = active
                      ? (payload?.[0]?.payload as PlanCharts["cumulative"][number] | undefined)
                      : undefined;
                    return r ? (
                      <TooltipShell title={r.date}>
                        <TooltipRow
                          color={S1}
                          label="Invested"
                          value={<Amount minor={r.investedMinor} currency={ccy} />}
                        />
                      </TooltipShell>
                    ) : null;
                  }}
                />
                <ReferenceLine
                  y={charts.estimatedValueMinor}
                  stroke={S2}
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
                <Line
                  type="stepAfter"
                  dataKey="investedMinor"
                  stroke={S1}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        )}
        <p className="text-xs text-muted-foreground">
          Estimated value is this plan&apos;s share of each holding (invested by the plan ÷ holding
          invested).
        </p>
      </div>
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Planned vs actual</h3>
        <ChartFrame
          label="Planned vs actual per period"
          summary={`${charts.periods.length} periods.`}
          legend={[
            { label: "Planned", color: S1, shape: "box" },
            { label: "Actual", color: S2, shape: "box" },
          ]}
          rows={charts.periods}
          columns={[
            { label: "Period", value: (r) => r.periodKey },
            {
              label: "Planned",
              numeric: true,
              value: (r) => <Amount minor={r.plannedMinor} currency={ccy} />,
            },
            {
              label: "Actual",
              numeric: true,
              value: (r) => <Amount minor={r.actualMinor} currency={ccy} />,
            },
            { label: "Status", value: (r) => r.status },
          ]}
          minWidthPx={charts.periods.length > 30 ? charts.periods.length * 36 : undefined}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={charts.periods}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              barGap={2}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="periodKey"
                {...AXIS}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={8}
              />
              <YAxis tickFormatter={moneyTick(ccy)} {...AXIS} axisLine={false} width={88} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  const r = active
                    ? (payload?.[0]?.payload as PlanCharts["periods"][number] | undefined)
                    : undefined;
                  return r ? (
                    <TooltipShell title={`${r.periodKey} · ${r.status}`}>
                      <TooltipRow
                        color={S1}
                        label="Planned"
                        value={<Amount minor={r.plannedMinor} currency={ccy} />}
                      />
                      <TooltipRow
                        color={S2}
                        label="Actual"
                        value={<Amount minor={r.actualMinor} currency={ccy} />}
                      />
                    </TooltipShell>
                  ) : null;
                }}
              />
              <Bar
                dataKey="plannedMinor"
                fill={S1}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="actualMinor"
                fill={S2}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
    </div>
  );
}
