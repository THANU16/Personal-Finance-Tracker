"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PriceInput, UnitsInput } from "@/components/shared/price-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { vizColor } from "@/lib/viz-palette";
import { executeSipAction } from "@/modules/sip/actions";
import type { ExecuteView } from "@/modules/sip/queries";
import {
  DipConfirmDialog,
  type DipConfirmation,
} from "@/modules/transactions/components/dip-confirm-dialog";
import type { ActionWarning } from "@/server/errors";

interface LineState {
  holdingId: string | null;
  actualMinor: number | null;
  feeMinor: number | null;
  units: number | null;
  priceMinorE4: number | null;
}

/** docs/05 §6 — Execute: planned vs actual per line, normal or drift-tilted split, status preview. */
export function ExecuteForm({ view, todayKey }: { view: ExecuteView; todayKey: string }) {
  const router = useRouter();
  const e = view.execution;
  const ccy = view.plan.currency;
  const [mode, setMode] = useState<"normal" | "tilt">(
    view.plan.useDriftTilt && view.tiltedPlanned ? "tilt" : "normal",
  );
  const plannedFor = (m: "normal" | "tilt") =>
    e.lines.map((l, i) =>
      m === "tilt" && view.tiltedPlanned ? view.tiltedPlanned[i]! : l.plannedMinor,
    );
  const [lines, setLines] = useState<LineState[]>(() =>
    e.lines.map((l, i) => ({
      holdingId: l.holdingId,
      actualMinor: plannedFor(mode)[i]!,
      feeMinor: 0,
      units: null,
      priceMinorE4: null,
    })),
  );
  const [executedOn, setExecutedOn] = useState(todayKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ActionWarning[] | null>(null);

  const actual = lines.reduce((s, l) => s + (l.actualMinor ?? 0), 0);
  const fees = lines.reduce((s, l) => s + ((l.actualMinor ?? 0) > 0 ? (l.feeMinor ?? 0) : 0), 0);
  const status = actual <= 0 ? null : actual >= e.plannedTotalMinor ? "done" : "partial";
  const balanceAfter = view.account.balanceMinor - actual - fees;
  const onTime = executedOn <= view.graceEnd;

  const groups = useMemo(() => {
    const byClass = new Map<string, number[]>();
    e.lines.forEach((l, i) =>
      byClass.set(l.assetClassId, [...(byClass.get(l.assetClassId) ?? []), i]),
    );
    return [...byClass.entries()];
  }, [e.lines]);

  function switchMode(m: "normal" | "tilt") {
    setMode(m);
    const planned = plannedFor(m);
    setLines((ls) => ls.map((l, i) => ({ ...l, actualMinor: planned[i]! })));
  }

  const update = (i: number, next: Partial<LineState>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...next } : l)));

  async function submit(flags?: DipConfirmation) {
    setPending(true);
    setError(null);
    const result = await executeSipAction(e.id, {
      executedOn,
      lines: lines.map((l) => ({
        holdingId: l.holdingId,
        actualMinor: l.actualMinor ?? 0,
        feeMinor: l.feeMinor ?? 0,
        units: l.units,
        priceMinorE4: l.priceMinorE4,
      })),
      ...flags,
    });
    setPending(false);
    if (!result.ok) {
      if (result.error.code === "NEEDS_CONFIRMATION" && result.error.warnings?.length) {
        setWarnings(result.error.warnings);
        return;
      }
      setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
      toast.error(result.error.message);
      return;
    }
    for (const w of result.data.warnings) toast.warning(w);
    toast.success(
      result.data.execution.status === "done" ? "SIP executed" : "SIP executed (partial)",
    );
    router.push("/sip?tab=history");
    router.refresh();
  }

  if (e.lines.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          This period has no allocation. Set your target allocation under Allocation (or give the
          plan its own split), then come back.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {e.planName} · {e.periodKey}
            <Badge variant={e.overdue ? "destructive" : "secondary"}>
              {e.status === "missed" ? "Missed" : e.overdue ? "Overdue" : "Due"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Due {e.dueDate} · on time until {view.graceEnd} · from {view.account.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">Planned</span>
            <Money
              valueMinor={e.plannedTotalMinor}
              currency={ccy}
              className="text-lg font-semibold"
            />
            {e.carryInMinor > 0 ? (
              <span className="text-xs text-muted-foreground">
                incl. <Money valueMinor={e.carryInMinor} currency={ccy} /> carried in
              </span>
            ) : null}
          </div>
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">Investing</span>
            <Money valueMinor={actual} currency={ccy} className="text-lg font-semibold" />
            {fees > 0 ? (
              <span className="text-xs text-muted-foreground">
                + <Money valueMinor={fees} currency={ccy} /> fees
              </span>
            ) : null}
          </div>
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">{view.account.name} after</span>
            <Money
              valueMinor={balanceAfter}
              currency={view.account.currency}
              className="text-lg font-semibold"
            />
            {balanceAfter < 0 ? (
              <span className="text-xs text-destructive">Goes below zero</span>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="executed-on" className="text-xs text-muted-foreground">
              Executed on
            </Label>
            <DatePicker
              id="executed-on"
              value={executedOn}
              onChange={(v) => v && setExecutedOn(v)}
            />
            {!onTime ? (
              <span className="text-xs text-muted-foreground">
                After the grace period: counts as late
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {view.tiltedPlanned ? (
        <div
          role="group"
          aria-label="Split"
          className="flex w-fit rounded-lg bg-muted p-0.5 text-sm"
        >
          {(["normal", "tilt"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-md px-3 py-1 ${mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              {m === "normal" ? "Normal split" : "Drift-tilted split"}
            </button>
          ))}
        </div>
      ) : null}

      {groups.map(([classId, idx]) => {
        const cls = view.classes.find((c) => c.id === classId);
        return (
          <Card key={classId}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="size-3 rounded-sm"
                  style={{ background: vizColor(cls?.color ?? "#6250d6") }}
                  aria-hidden
                />
                {cls?.name ?? "Asset class"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {idx.map((i) => {
                const l = e.lines[i]!;
                const s = lines[i]!;
                const options = view.holdingsByClass[classId] ?? [];
                const name = options.find((o) => o.id === s.holdingId)?.name;
                return (
                  <div
                    key={i}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1.4fr_1fr_1fr_0.8fr]"
                  >
                    <div className="grid gap-1">
                      {l.holdingId ? (
                        <span className="font-medium">{name ?? "Holding"}</span>
                      ) : (
                        <Select
                          value={s.holdingId ?? ""}
                          onValueChange={(v) => update(i, { holdingId: v || null })}
                          items={options.map((o) => ({ value: o.id, label: o.name }))}
                        >
                          <SelectTrigger
                            aria-label={`Holding for ${cls?.name ?? "class"}`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Choose a holding" />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Planned <Money valueMinor={plannedFor(mode)[i]!} currency={ccy} />
                      </span>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground" htmlFor={`actual-${i}`}>
                        Actual
                      </Label>
                      <MoneyInput
                        id={`actual-${i}`}
                        currency={ccy}
                        value={s.actualMinor}
                        onChange={(v) => update(i, { actualMinor: v })}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground" htmlFor={`fee-${i}`}>
                        Fee
                      </Label>
                      <MoneyInput
                        id={`fee-${i}`}
                        currency={ccy}
                        value={s.feeMinor}
                        onChange={(v) => update(i, { feeMinor: v })}
                      />
                    </div>
                    <details className="grid gap-1 text-xs sm:col-span-4">
                      <summary className="cursor-pointer text-muted-foreground">
                        Units and price (optional)
                      </summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1">
                          <Label htmlFor={`price-${i}`}>Price per unit</Label>
                          <PriceInput
                            id={`price-${i}`}
                            currency={ccy}
                            value={s.priceMinorE4}
                            onChange={(v) => {
                              const units =
                                v && s.actualMinor
                                  ? Math.round(((s.actualMinor * 10_000) / v) * 1e6) / 1e6
                                  : s.units;
                              update(i, { priceMinorE4: v, units });
                            }}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`units-${i}`}>Units (auto = actual ÷ price)</Label>
                          <UnitsInput
                            id={`units-${i}`}
                            value={s.units}
                            onChange={(v) => update(i, { units: v })}
                          />
                        </div>
                      </div>
                    </details>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {status === null
            ? "Enter at least one amount (or skip this period)"
            : status === "done"
              ? "Will be marked done"
              : "Will be marked partial"}
          {status !== null && !onTime ? " · late" : ""}
        </span>
        <Button onClick={() => void submit()} disabled={pending || status === null}>
          {pending ? "Executing…" : "Confirm"}
        </Button>
      </div>
      <DipConfirmDialog
        warnings={warnings}
        onCancel={() => setWarnings(null)}
        onConfirm={async (flags) => {
          setWarnings(null);
          await submit(flags);
        }}
      />
    </div>
  );
}
