"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AllocationTreeEditor, treeIsValid } from "@/components/shared/allocation-tree-editor";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AllocationTree } from "@/domain/allocation";
import { formatPercentBp } from "@/lib/format";
import { vizColor } from "@/lib/viz-palette";
import { createPlanAction, setPlanStatusAction, updatePlanAction } from "@/modules/sip/actions";
import type { PlanEditorData } from "@/modules/sip/queries";

const DAYS = [
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` })),
  { value: "31", label: "Last day of the month" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
  (label, i) => ({ value: String(i), label }),
);

interface State {
  name: string;
  amountMinor: number | null;
  frequency: "monthly" | "weekly";
  dayOfMonth: number;
  weekday: number;
  sourceAccountId: string;
  startDate: string;
  endDate: string | null;
  stepUpOn: boolean;
  stepPercentBp: number | null;
  stepEvery: number;
  missedPolicy: "skip" | "carry_forward";
  graceDays: number;
  useDriftTilt: boolean;
  notes: string;
  allocationSource: "target" | "custom";
  allocation: AllocationTree;
}

/** docs/05 §6 — plan editor (/sip/plans/new and /sip/plans/[id]). */
export function PlanEditor({ data, todayKey }: { data: PlanEditorData; todayKey: string }) {
  const router = useRouter();
  const p = data.plan;
  const [s, setS] = useState<State>({
    name: p?.name ?? "",
    amountMinor: p?.amountMinor ?? null,
    frequency: p?.frequency ?? "monthly",
    dayOfMonth: p?.dayOfMonth ?? Math.min(28, Number(todayKey.slice(8))),
    weekday: p?.weekday ?? 1,
    sourceAccountId: p?.sourceAccountId ?? data.accounts[0]?.id ?? "",
    startDate: p?.startDate ?? todayKey,
    endDate: p?.endDate ?? null,
    stepUpOn: Boolean(p?.stepUp),
    stepPercentBp: p?.stepUp?.percentBp ?? 1_000,
    stepEvery: p?.stepUp?.everyMonths ?? 12,
    missedPolicy: p?.missedPolicy ?? "skip",
    graceDays: p?.graceDays ?? 7,
    useDriftTilt: p?.useDriftTilt ?? false,
    notes: p?.notes ?? "",
    allocationSource: p?.allocationSource ?? "target",
    allocation: p?.allocation ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((x) => ({ ...x, [k]: v }));
  const account = data.accounts.find((a) => a.id === s.sourceAccountId);
  const currency = p?.currency ?? account?.currency ?? "LKR";
  const accounts = p ? data.accounts.filter((a) => a.currency === p.currency) : data.accounts;

  const versionChange =
    p !== null &&
    (p.amountMinor !== s.amountMinor ||
      p.allocationSource !== s.allocationSource ||
      JSON.stringify(p.allocation) !==
        JSON.stringify(s.allocationSource === "custom" ? s.allocation : []));

  // Target issues the plan would inherit (empty target, classes without holdings, other currency).
  const targetNotes = useMemo(() => {
    const notes: string[] = [];
    if (data.target.allocation.length === 0)
      notes.push("No target allocation yet — set it under Allocation first.");
    for (const c of data.target.allocation) {
      const name = data.treeOptions.classes.find((x) => x.id === c.assetClassId)?.name ?? "A class";
      if (c.assets.length === 0)
        notes.push(`${name} has no holdings in the target: you will pick one when executing.`);
      for (const a of c.assets) {
        const h = data.treeOptions.holdings.find((x) => x.id === a.holdingId);
        if (h && h.currency !== currency)
          notes.push(`${h.name} is in ${h.currency}; this plan invests ${currency}.`);
      }
    }
    return notes;
  }, [data, currency]);

  const input = () => ({
    name: s.name,
    amountMinor: s.amountMinor ?? 0,
    frequency: s.frequency,
    dayOfMonth: s.frequency === "monthly" ? s.dayOfMonth : null,
    weekday: s.frequency === "weekly" ? s.weekday : null,
    sourceAccountId: s.sourceAccountId,
    startDate: s.startDate,
    endDate: s.endDate,
    stepUp: s.stepUpOn ? { percentBp: s.stepPercentBp ?? 0, everyMonths: s.stepEvery } : null,
    missedPolicy: s.missedPolicy,
    graceDays: s.graceDays,
    useDriftTilt: s.useDriftTilt,
    notes: s.notes || null,
    allocationSource: s.allocationSource,
    allocation: s.allocationSource === "custom" ? s.allocation : null,
  });

  async function save(): Promise<boolean> {
    setPending(true);
    setErrors({});
    const result = p ? await updatePlanAction(p.id, input()) : await createPlanAction(input());
    setPending(false);
    if (!result.ok) {
      setErrors(
        Object.fromEntries(
          Object.entries(result.error.fieldErrors ?? {}).map(([k, m]) => [
            k.split(".")[0]!,
            m[0] ?? "",
          ]),
        ),
      );
      toast.error(result.error.message);
      return false;
    }
    for (const w of result.data.warnings) toast.warning(w);
    const version =
      "newVersion" in result.data
        ? (result.data as unknown as { newVersion: number | null; effectiveFrom: string | null })
        : null;
    if (version?.newVersion) {
      toast.success(
        `Saved as version ${version.newVersion}, effective from ${version.effectiveFrom}`,
      );
    } else toast.success(p ? "Plan saved" : "Plan created");
    router.push("/sip");
    router.refresh();
    return true;
  }

  async function status(next: "active" | "paused" | "ended") {
    if (!p) return false;
    const result = await setPlanStatusAction(p.id, next);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success(
      next === "paused" ? "Plan paused" : next === "ended" ? "Plan ended" : "Plan resumed",
    );
    router.refresh();
  }

  const customValid =
    s.allocationSource === "target" || treeIsValid(s.allocation, data.treeOptions, true);
  const canSave =
    s.name.trim() && (s.amountMinor ?? 0) > 0 && s.sourceAccountId && customValid && !pending;
  const saveButton = (
    <Button disabled={!canSave}>{pending ? "Saving…" : p ? "Save changes" : "Create plan"}</Button>
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="sip-name" label="Name" error={errors.name}>
            <Input
              id="sip-name"
              value={s.name}
              onChange={(e) => set("name", e.target.value)}
              {...fieldAria("sip-name", errors.name)}
            />
          </FormField>
          <FormField id="sip-amount" label="Amount each period" error={errors.amountMinor}>
            <MoneyInput
              id="sip-amount"
              currency={currency}
              value={s.amountMinor}
              onChange={(v) => set("amountMinor", v)}
              {...fieldAria("sip-amount", errors.amountMinor)}
            />
          </FormField>
          <FormField id="sip-frequency" label="Frequency">
            <Select
              value={s.frequency}
              onValueChange={(v) => v && set("frequency", v as State["frequency"])}
              items={[
                { value: "monthly", label: "Monthly" },
                { value: "weekly", label: "Weekly" },
              ]}
            >
              <SelectTrigger id="sip-frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {s.frequency === "monthly" ? (
            <FormField id="sip-day" label="Day of the month" error={errors.dayOfMonth}>
              <Select
                value={String(s.dayOfMonth)}
                onValueChange={(v) => v && set("dayOfMonth", Number(v))}
                items={DAYS}
              >
                <SelectTrigger id="sip-day" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {DAYS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : (
            <FormField id="sip-weekday" label="Weekday" error={errors.weekday}>
              <Select
                value={String(s.weekday)}
                onValueChange={(v) => v && set("weekday", Number(v))}
                items={WEEKDAYS}
              >
                <SelectTrigger id="sip-weekday" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <FormField id="sip-account" label="Pay from" error={errors.sourceAccountId}>
            <Select
              value={s.sourceAccountId}
              onValueChange={(v) => v && set("sourceAccountId", v)}
              items={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
            >
              <SelectTrigger id="sip-account" className="w-full">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="sip-start" label="Start" error={errors.startDate}>
              <DatePicker
                id="sip-start"
                value={s.startDate}
                onChange={(v) => v && set("startDate", v)}
              />
            </FormField>
            <FormField id="sip-end" label="End (optional)" error={errors.endDate}>
              <DatePicker
                id="sip-end"
                value={s.endDate}
                onChange={(v) => set("endDate", v ?? null)}
                placeholder="No end"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Switch
                id="sip-stepup"
                checked={s.stepUpOn}
                onCheckedChange={(v) => set("stepUpOn", v)}
              />
              <Label htmlFor="sip-stepup" className="font-normal">
                Step up the amount over time
              </Label>
            </div>
            {s.stepUpOn ? (
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <FormField id="sip-step" label="Increase by">
                  <PercentInput
                    id="sip-step"
                    value={s.stepPercentBp}
                    onChange={(v) => set("stepPercentBp", v)}
                  />
                </FormField>
                <FormField id="sip-every" label="Every (months)">
                  <Input
                    id="sip-every"
                    type="number"
                    min={1}
                    max={120}
                    value={s.stepEvery}
                    onChange={(e) => set("stepEvery", Number(e.target.value) || 1)}
                  />
                </FormField>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label id="sip-missed-label">If a period is missed</Label>
            <RadioGroup
              aria-labelledby="sip-missed-label"
              value={s.missedPolicy}
              onValueChange={(v) => set("missedPolicy", v as State["missedPolicy"])}
            >
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="skip" /> Skip it
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="carry_forward" /> Carry the shortfall into the next period
              </Label>
            </RadioGroup>
          </div>
          <FormField
            id="sip-grace"
            label="Grace days"
            description="After this many days a due period counts as missed."
          >
            <Input
              id="sip-grace"
              type="number"
              min={0}
              max={60}
              value={s.graceDays}
              onChange={(e) => set("graceDays", Math.max(0, Number(e.target.value) || 0))}
              {...fieldAria("sip-grace", undefined, true)}
            />
          </FormField>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              id="sip-tilt"
              checked={s.useDriftTilt}
              onCheckedChange={(v) => set("useDriftTilt", v)}
            />
            <Label htmlFor="sip-tilt" className="font-normal">
              Suggest a drift-tilted split when executing (buys more of what is under target)
            </Label>
          </div>
          <FormField id="sip-notes" label="Notes (optional)">
            <Textarea
              id="sip-notes"
              rows={2}
              value={s.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocation</CardTitle>
          <CardDescription>
            How each payment is split across asset classes and holdings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <RadioGroup
            aria-label="Allocation source"
            value={s.allocationSource}
            onValueChange={(v) => set("allocationSource", v as State["allocationSource"])}
            className="grid-cols-1 sm:grid-cols-2"
          >
            <Label className="flex items-start gap-2 rounded-lg border p-3 font-normal">
              <RadioGroupItem value="target" className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium">Use my target allocation</span>
                <span className="text-xs text-muted-foreground">
                  Follows target changes for future periods.
                </span>
              </span>
            </Label>
            <Label className="flex items-start gap-2 rounded-lg border p-3 font-normal">
              <RadioGroupItem value="custom" className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium">Custom split for this plan</span>
                <span className="text-xs text-muted-foreground">Its own classes and holdings.</span>
              </span>
            </Label>
          </RadioGroup>
          {s.allocationSource === "target" ? (
            <div className="grid gap-2 text-sm">
              <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Target allocation">
                {data.target.allocation.map((c) => {
                  const cls = data.treeOptions.classes.find((x) => x.id === c.assetClassId);
                  return (
                    <li key={c.assetClassId} className="flex items-center gap-1.5">
                      <span
                        className="size-2.5 rounded-sm"
                        style={{ background: vizColor(cls?.color ?? "#6250d6") }}
                        aria-hidden
                      />
                      {cls?.name} {formatPercentBp(c.percentBp)}
                    </li>
                  );
                })}
              </ul>
              {targetNotes.map((n) => (
                <p key={n} className="text-xs text-muted-foreground">
                  {n}
                </p>
              ))}
            </div>
          ) : (
            <AllocationTreeEditor
              value={s.allocation}
              onChange={(t) => set("allocation", t)}
              options={data.treeOptions}
              totalMinor={s.amountMinor}
              currency={currency}
              requireAssets
              holdingCurrency={currency}
            />
          )}
          {errors.allocation ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.allocation}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {p && p.status !== "ended" ? (
            <>
              <Button
                variant="outline"
                onClick={() => void status(p.status === "paused" ? "active" : "paused")}
              >
                {p.status === "paused" ? "Resume" : "Pause"}
              </Button>
              <ConfirmDialog
                trigger={<Button variant="outline">End plan</Button>}
                title="End this plan?"
                description="No new periods are created. Executed periods and their investments stay."
                confirmLabel="End plan"
                destructive
                onConfirm={() => status("ended")}
              />
            </>
          ) : null}
        </div>
        {versionChange ? (
          <ConfirmDialog
            trigger={saveButton}
            title={`This creates version ${(p?.currentVersion ?? 0) + 1}`}
            description={`The new amount or allocation applies from ${data.nextDueDate ?? "the next period"}. Executed periods keep what they used.`}
            confirmLabel="Save"
            onConfirm={save}
          />
        ) : (
          <Button onClick={() => void save()} disabled={!canSave}>
            {pending ? "Saving…" : p ? "Save changes" : "Create plan"}
          </Button>
        )}
      </div>
    </div>
  );
}
