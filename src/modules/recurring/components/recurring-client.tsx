"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { Pause, Play, Plus, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { CategorySelect } from "@/modules/categories/components/category-select";
import type { CategoryNode } from "@/modules/categories/schemas";
import {
  confirmRuleAction,
  createRuleAction,
  setRuleStatusAction,
  skipRuleAction,
  updateRuleAction,
} from "@/modules/recurring/actions";
import type { RuleDTO } from "@/modules/recurring/schemas";
import {
  DipConfirmDialog,
  type DipConfirmation,
} from "@/modules/transactions/components/dip-confirm-dialog";
import type { ActionWarning } from "@/server/errors";
import { stackOnPhone } from "@/components/shared/mobile/stack-table";
import { cn } from "@/lib/utils";

export interface RecurringOptions {
  todayKey: string;
  baseCurrency: string;
  accounts: { id: string; name: string; currency: string }[];
  debts: { id: string; name: string }[];
  categories: CategoryNode[];
}

const KIND_LABEL = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  debt_payment: "Loan payment",
} as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string | null) => (d ? format(parseISO(d), "d MMM yyyy") : "—");

function frequencyLabel(r: RuleDTO): string {
  if (r.frequency === "weekly")
    return `${r.interval > 1 ? `Every ${r.interval} weeks` : "Weekly"} · ${WEEKDAYS[r.weekday ?? 0]}`;
  const day = r.dayOfMonth ? ` · day ${r.dayOfMonth}` : "";
  if (r.frequency === "yearly") return `Yearly · ${MONTHS[(r.monthOfYear ?? 1) - 1]}${day}`;
  if (r.frequency === "every_n_months") return `Every ${r.interval} months${day}`;
  return `Monthly${day}`;
}

function Pick({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={options}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RuleDialog({
  rule,
  options,
  onClose,
}: {
  rule: RuleDTO | null;
  options: RecurringOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: rule?.name ?? "",
    kind: rule?.kind ?? ("expense" as RuleDTO["kind"]),
    amountMinor: (rule?.amountMinor ?? null) as number | null,
    fromAccountId: rule?.fromAccount?.id ?? options.accounts[0]?.id ?? "",
    toAccountId: rule?.toAccount?.id ?? options.accounts[1]?.id ?? options.accounts[0]?.id ?? "",
    categoryId: rule?.category?.id ?? "",
    debtId: rule?.debt?.id ?? options.debts[0]?.id ?? "",
    description: rule?.description ?? "",
    frequency: rule?.frequency ?? ("monthly" as RuleDTO["frequency"]),
    interval: String(rule?.interval ?? 1),
    dayOfMonth: String(rule?.dayOfMonth ?? Number(options.todayKey.slice(8))),
    weekday: String(rule?.weekday ?? 1),
    monthOfYear: String(rule?.monthOfYear ?? Number(options.todayKey.slice(5, 7))),
    startDate: (rule?.startDate ?? options.todayKey) as string | null,
    endDate: (rule?.endDate ?? null) as string | null,
    reminderDaysBefore: String(rule?.reminderDaysBefore ?? 2),
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const currency =
    options.accounts.find((a) => a.id === (f.kind === "income" ? f.toAccountId : f.fromAccountId))
      ?.currency ?? options.baseCurrency;
  const err = (k: string) => errors[k]?.[0];
  const accounts = options.accounts.map((a) => ({
    value: a.id,
    label: `${a.name} · ${a.currency}`,
  }));
  const needsFrom = f.kind !== "income";
  const needsTo = f.kind === "income" || f.kind === "transfer";

  function save() {
    start(async () => {
      const input = {
        name: f.name,
        kind: f.kind,
        amountMinor: f.amountMinor ?? Number.NaN,
        fromAccountId: needsFrom ? f.fromAccountId : null,
        toAccountId: needsTo ? f.toAccountId : null,
        categoryId: f.kind === "income" || f.kind === "expense" ? f.categoryId || null : null,
        debtId: f.kind === "debt_payment" ? f.debtId || null : null,
        description: f.description,
        frequency: f.frequency,
        interval: Number(f.interval) || 1,
        dayOfMonth: f.frequency === "weekly" ? null : Number(f.dayOfMonth) || null,
        weekday: f.frequency === "weekly" ? Number(f.weekday) : null,
        monthOfYear: f.frequency === "yearly" ? Number(f.monthOfYear) : null,
        startDate: f.startDate ?? "",
        endDate: f.endDate,
        reminderDaysBefore: Number(f.reminderDaysBefore) || 0,
      };
      const res = rule ? await updateRuleAction(rule.id, input) : await createRuleAction(input);
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success(rule ? "Rule saved" : "Rule added");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "New recurring rule"}</DialogTitle>
          <DialogDescription>
            A template you confirm when it happens. Nothing is posted automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="rule-name" label="Name" error={err("name")}>
            <Input id="rule-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField id="rule-kind" label="Kind">
            <Pick
              id="rule-kind"
              value={f.kind}
              onChange={(v) => set("kind", v as RuleDTO["kind"])}
              options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </FormField>
          <FormField id="rule-amount" label="Amount" error={err("amountMinor")}>
            <MoneyInput
              id="rule-amount"
              currency={currency}
              value={f.amountMinor}
              onChange={(v) => set("amountMinor", v)}
            />
          </FormField>
          {needsFrom ? (
            <FormField
              id="rule-from"
              label={f.kind === "transfer" ? "From" : "Paid from"}
              error={err("fromAccountId")}
            >
              <Pick
                id="rule-from"
                value={f.fromAccountId}
                onChange={(v) => set("fromAccountId", v)}
                options={accounts}
              />
            </FormField>
          ) : null}
          {needsTo ? (
            <FormField
              id="rule-to"
              label={f.kind === "transfer" ? "To" : "Received into"}
              error={err("toAccountId")}
            >
              <Pick
                id="rule-to"
                value={f.toAccountId}
                onChange={(v) => set("toAccountId", v)}
                options={accounts}
              />
            </FormField>
          ) : null}
          {f.kind === "income" || f.kind === "expense" ? (
            <FormField id="rule-category" label="Category" error={err("categoryId")}>
              <CategorySelect
                id="rule-category"
                tree={options.categories}
                kind={f.kind}
                value={f.categoryId}
                onChange={(v) => set("categoryId", v)}
              />
            </FormField>
          ) : null}
          {f.kind === "debt_payment" ? (
            <FormField id="rule-debt" label="Loan" error={err("debtId")}>
              <Pick
                id="rule-debt"
                value={f.debtId}
                onChange={(v) => set("debtId", v)}
                options={options.debts.map((d) => ({ value: d.id, label: d.name }))}
                placeholder="Add a loan first"
              />
            </FormField>
          ) : null}
          <FormField id="rule-frequency" label="Repeats">
            <Pick
              id="rule-frequency"
              value={f.frequency}
              onChange={(v) => set("frequency", v as RuleDTO["frequency"])}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "weekly", label: "Weekly" },
                { value: "every_n_months", label: "Every N months" },
                { value: "yearly", label: "Yearly" },
              ]}
            />
          </FormField>
          {f.frequency === "weekly" ? (
            <FormField id="rule-weekday" label="Weekday" error={err("weekday")}>
              <Pick
                id="rule-weekday"
                value={f.weekday}
                onChange={(v) => set("weekday", v)}
                options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))}
              />
            </FormField>
          ) : (
            <FormField
              id="rule-day"
              label="Day of month"
              error={err("dayOfMonth")}
              description="31 = last day of shorter months"
            >
              <Input
                id="rule-day"
                inputMode="numeric"
                value={f.dayOfMonth}
                onChange={(e) => set("dayOfMonth", e.target.value)}
              />
            </FormField>
          )}
          {f.frequency === "weekly" || f.frequency === "every_n_months" ? (
            <FormField
              id="rule-interval"
              label={f.frequency === "weekly" ? "Every N weeks" : "Every N months"}
            >
              <Input
                id="rule-interval"
                inputMode="numeric"
                value={f.interval}
                onChange={(e) => set("interval", e.target.value)}
              />
            </FormField>
          ) : null}
          {f.frequency === "yearly" ? (
            <FormField id="rule-month" label="Month">
              <Pick
                id="rule-month"
                value={f.monthOfYear}
                onChange={(v) => set("monthOfYear", v)}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              />
            </FormField>
          ) : null}
          <FormField id="rule-start" label="Starts" error={err("startDate")}>
            <DatePicker id="rule-start" value={f.startDate} onChange={(v) => set("startDate", v)} />
          </FormField>
          <FormField id="rule-end" label="Ends (optional)" error={err("endDate")}>
            <DatePicker
              id="rule-end"
              value={f.endDate}
              onChange={(v) => set("endDate", v)}
              placeholder="No end"
            />
          </FormField>
          <FormField id="rule-reminder" label="Remind days before">
            <Input
              id="rule-reminder"
              inputMode="numeric"
              value={f.reminderDaysBefore}
              onChange={(e) => set("reminderDaysBefore", e.target.value)}
            />
          </FormField>
          <FormField id="rule-description" label="Description (optional)">
            <Input
              id="rule-description"
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : rule ? "Save rule" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ rule, onClose }: { rule: RuleDTO; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(rule.amountMinor);
  const [date, setDate] = useState<string | null>(rule.nextDueDate);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ActionWarning[] | null>(null);
  const [pending, start] = useTransition();

  async function submit(flags?: DipConfirmation) {
    const res = await confirmRuleAction(rule.id, {
      dueDate: rule.nextDueDate,
      date,
      amountMinor: amount ?? Number.NaN,
      ...flags,
    });
    if (!res.ok) {
      if (res.error.code === "NEEDS_CONFIRMATION" && res.error.warnings)
        setWarnings(res.error.warnings);
      else setError(res.error.message);
      return;
    }
    for (const w of res.data.warnings) toast.warning(w);
    toast.success(`${rule.name} posted`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm {rule.name}</DialogTitle>
          <DialogDescription>
            Posts the real transaction for {fmtDate(rule.nextDueDate)} and moves to the next date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField
            id="confirm-amount"
            label="Amount"
            description={rule.isVariableAmount ? "Varies: enter what it actually was" : undefined}
          >
            <MoneyInput
              id="confirm-amount"
              currency={rule.currency}
              value={amount}
              onChange={setAmount}
            />
          </FormField>
          <FormField id="confirm-date" label="Date">
            <DatePicker id="confirm-date" value={date} onChange={setDate} />
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => start(() => submit())}>
            {pending ? "Posting…" : "Confirm"}
          </Button>
        </DialogFooter>
        <DipConfirmDialog
          warnings={warnings}
          onCancel={() => setWarnings(null)}
          onConfirm={async (flags) => {
            setWarnings(null);
            await submit(flags);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function RecurringClient({
  rules,
  options,
}: {
  rules: RuleDTO[];
  options: RecurringOptions;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleDTO | "new" | null>(null);
  const [confirming, setConfirming] = useState<RuleDTO | null>(null);
  const [, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error?.message ?? "Failed");
      else {
        toast.success(done);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden /> New rule
        </Button>
      </div>
      {rules.length ? (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className={cn("w-full text-sm", stackOnPhone)}>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Frequency</th>
                  <th className="py-2 pr-3 font-medium">Next due</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t" data-testid={`rule-${r.name}`}>
                    <td className="py-2 pr-3 font-medium">{r.name}</td>
                    <td className="py-2 pr-3">{KIND_LABEL[r.kind]}</td>
                    <td className="py-2 pr-3 text-right">
                      <Money valueMinor={r.amountMinor} currency={r.currency} />
                      {r.isVariableAmount ? (
                        <span className="block text-xs text-muted-foreground">varies</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {r.kind === "transfer"
                        ? `${r.fromAccount?.name} → ${r.toAccount?.name}`
                        : r.kind === "debt_payment"
                          ? `${r.fromAccount?.name} → ${r.debt?.name}`
                          : (r.fromAccount ?? r.toAccount)?.name}
                    </td>
                    <td className="py-2 pr-3">{frequencyLabel(r)}</td>
                    <td data-label="Next due" className="py-2 pr-3 whitespace-nowrap">
                      {fmtDate(r.nextDueDate)}
                      {r.overdue ? (
                        <span className="block text-xs text-destructive">Overdue</span>
                      ) : r.dueSoon ? (
                        <span className="block text-xs text-muted-foreground">Due soon</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={r.status === "active" ? "secondary" : "outline"}>
                        {r.status === "active"
                          ? "Active"
                          : r.status === "paused"
                            ? "Paused"
                            : "Ended"}
                      </Badge>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.status === "active" && r.nextDueDate ? (
                          <>
                            <Button size="sm" onClick={() => setConfirming(r)}>
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Skip ${r.name}`}
                              onClick={() =>
                                run(
                                  () => skipRuleAction(r.id, { dueDate: r.nextDueDate }),
                                  `${r.name} skipped`,
                                )
                              }
                            >
                              <SkipForward aria-hidden /> Skip
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="max-md:min-w-11"
                              aria-label={`Pause ${r.name}`}
                              onClick={() =>
                                run(() => setRuleStatusAction(r.id, "paused"), "Paused")
                              }
                            >
                              <Pause aria-hidden />
                            </Button>
                          </>
                        ) : r.status === "paused" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              run(() => setRuleStatusAction(r.id, "active"), "Resumed")
                            }
                          >
                            <Play aria-hidden /> Resume
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="No recurring rules"
          description="Add salary, rent, bills, subscriptions or EMIs once; confirm each one when it happens."
          action={<Button onClick={() => setEditing("new")}>New rule</Button>}
        />
      )}
      {editing ? (
        <RuleDialog
          rule={editing === "new" ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirming ? <ConfirmDialog rule={confirming} onClose={() => setConfirming(null)} /> : null}
    </div>
  );
}
