"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GoalStatus } from "@/domain/goals";
import { formatPercentBp } from "@/lib/format";
import { archiveGoalAction, deleteGoalAction, saveGoalAction } from "@/modules/goals/actions";
import type { GoalDTO, GoalsOverviewDTO } from "@/modules/goals/service";

const fmtDate = (d: string) => format(parseISO(d), "MMM yyyy");
const STATUS: Record<
  GoalStatus,
  { label: string; variant: "secondary" | "outline" | "destructive" | "default" }
> = {
  achieved: { label: "Achieved", variant: "default" },
  on_track: { label: "On track", variant: "secondary" },
  off_track: { label: "Off track", variant: "destructive" },
  overdue: { label: "Date passed", variant: "outline" },
};

/** Progress ring (one series in slot 1 on a muted track); the % is printed in the middle. */
function Ring({ bp }: { bp: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 64 64"
      className="size-16 shrink-0"
      role="img"
      aria-label={`${formatPercentBp(bp)} reached`}
    >
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--viz-series-1)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(10_000, bp)) / 10_000} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        fontSize="12"
        fill="var(--foreground)"
        fontWeight="600"
      >
        {Math.round(bp / 100)}%
      </text>
    </svg>
  );
}

interface LinkState {
  key: string;
  shareBp: number | null;
}

function GoalDialog({
  goal,
  data,
  onClose,
}: {
  goal: GoalDTO | null;
  data: GoalsOverviewDTO;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState<number | null>(goal?.targetMinor ?? null);
  const [date, setDate] = useState<string | null>(goal?.targetDate ?? null);
  const [ret, setRet] = useState<number | null>(goal?.expectedReturnBp ?? 0);
  const [priority, setPriority] = useState(String(goal?.priority ?? 3));
  const [links, setLinks] = useState<LinkState[]>(
    goal?.links.map((l) => ({ key: `${l.kind}:${l.refId}`, shareBp: l.shareBp })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const own = new Map(goal?.links.map((l) => [l.refId, l.shareBp]) ?? []);
  const options = data.options.map((o) => ({
    ...o,
    key: `${o.kind}:${o.id}`,
    free: 10_000 - o.usedBp + (own.get(o.id) ?? 0),
  }));
  const unused = options.filter((o) => o.free > 0 && !links.some((l) => l.key === o.key));

  function save() {
    start(async () => {
      const res = await saveGoalAction(goal?.id ?? null, {
        name,
        targetMinor: target ?? Number.NaN,
        targetDate: date ?? "",
        expectedReturnBp: ret ?? 0,
        priority: Number(priority),
        links: links.map((l) => {
          const [kind, refId] = l.key.split(":") as ["account" | "holding", string];
          return { kind, refId, shareBp: l.shareBp ?? Number.NaN };
        }),
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success(goal ? "Goal saved" : "Goal added");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
          <DialogDescription>
            Link the accounts and investments that fund it, with the share of each.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField id="goal-name" label="Name" error={errors.name?.[0]}>
              <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
          </div>
          <FormField id="goal-target" label="Target amount" error={errors.targetMinor?.[0]}>
            <MoneyInput
              id="goal-target"
              currency={data.currency}
              value={target}
              onChange={setTarget}
            />
          </FormField>
          <FormField id="goal-date" label="Target date" error={errors.targetDate?.[0]}>
            <DatePicker id="goal-date" value={date} onChange={setDate} />
          </FormField>
          <FormField
            id="goal-return"
            label="Expected return a year"
            description="0% = savings only"
          >
            <PercentInput id="goal-return" value={ret} onChange={setRet} />
          </FormField>
          <FormField id="goal-priority" label="Priority (1 = highest)">
            <Input
              id="goal-priority"
              inputMode="numeric"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </FormField>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Linked items</legend>
          {links.map((l, i) => {
            const o = options.find((x) => x.key === l.key);
            return (
              <div key={l.key} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <p className="text-sm">
                  {o?.name ?? "Removed item"}{" "}
                  <span className="text-xs text-muted-foreground">({o?.kind})</span>
                </p>
                <PercentInput
                  aria-label={`Share of ${o?.name}`}
                  value={l.shareBp}
                  onChange={(v) =>
                    setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, shareBp: v } : x)))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Unlink ${o?.name}`}
                  onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
                {errors[`links.${i}.shareBp`]?.[0] ? (
                  <p className="col-span-3 text-xs text-destructive">
                    {errors[`links.${i}.shareBp`]![0]}
                  </p>
                ) : null}
              </div>
            );
          })}
          {unused.length ? (
            <Select
              value=""
              onValueChange={(v) => {
                const o = options.find((x) => x.key === String(v));
                if (o) setLinks((ls) => [...ls, { key: o.key, shareBp: Math.min(10_000, o.free) }]);
              }}
              items={unused.map((o) => ({ value: o.key, label: o.name }))}
            >
              <SelectTrigger aria-label="Link an account or holding" className="w-full">
                <SelectValue placeholder="Link an account or holding" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {unused.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.name} · {o.kind}
                    {o.free < 10_000 ? ` · ${formatPercentBp(o.free)} free` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : goal ? "Save goal" : "Add goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GoalsClient({ data }: { data: GoalsOverviewDTO }) {
  const router = useRouter();
  const [editing, setEditing] = useState<GoalDTO | "new" | null>(null);
  const [, start] = useTransition();
  const active = data.goals.filter((g) => !g.archived);
  const archived = data.goals.filter((g) => g.archived);
  const act = (p: Promise<{ ok: boolean; error?: { message: string } }>, msg: string) =>
    start(async () => {
      const res = await p;
      if (!res.ok) toast.error(res.error?.message ?? "Failed");
      else {
        toast.success(msg);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden /> New goal
        </Button>
      </div>
      {active.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((g) => (
            <Card key={g.id} data-testid={`goal-${g.name}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">
                    {g.icon ? <span aria-hidden>{g.icon} </span> : null}
                    {g.name}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <Money valueMinor={g.targetMinor} currency={g.currency} /> by{" "}
                    {fmtDate(g.targetDate)}
                  </p>
                </div>
                <Ring bp={g.progressBp} />
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={STATUS[g.status].variant}>{STATUS[g.status].label}</Badge>
                  <span className="text-muted-foreground">
                    {g.monthsLeft ? `${g.monthsLeft} months left` : "—"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Current</dt>
                  <dd className="text-right">
                    <Money valueMinor={g.currentMinor} currency={g.currency} />
                  </dd>
                  <dt className="text-muted-foreground">Still needed</dt>
                  <dd className="text-right">
                    <Money valueMinor={g.shortfallMinor} currency={g.currency} />
                  </dd>
                  <dt className="text-muted-foreground">Required a month</dt>
                  <dd className="text-right font-medium">
                    <Money valueMinor={g.requiredMonthlyMinor} currency={g.currency} />
                  </dd>
                  <dt className="text-muted-foreground">You add a month</dt>
                  <dd className="text-right">
                    <Money valueMinor={g.avgMonthlyContributionMinor} currency={g.currency} />
                  </dd>
                </dl>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Linked items ({g.links.length})
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {g.links.map((l) => (
                      <li key={l.refId} className="flex justify-between gap-2">
                        <span>
                          {l.name} · {formatPercentBp(l.shareBp)}
                        </span>
                        <Money valueMinor={l.countedMinor} currency={g.currency} />
                      </li>
                    ))}
                    {!g.links.length ? (
                      <li className="text-muted-foreground">Nothing linked yet.</li>
                    ) : null}
                  </ul>
                </details>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(archiveGoalAction(g.id, true), "Goal archived")}
                  >
                    Archive
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No goals yet"
          description="Set a target (house deposit, car, education) and link the savings and investments that fund it."
          action={<Button onClick={() => setEditing("new")}>New goal</Button>}
        />
      )}
      {archived.length ? (
        <details className="rounded-lg border px-4 py-3 text-sm">
          <summary className="cursor-pointer">Archived ({archived.length})</summary>
          <ul className="mt-2 divide-y">
            {archived.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>{g.name}</span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(archiveGoalAction(g.id, false), "Goal restored")}
                  >
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(deleteGoalAction(g.id), "Goal deleted")}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {editing ? (
        <GoalDialog
          goal={editing === "new" ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
