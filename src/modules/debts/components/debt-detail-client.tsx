"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { Check } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { StatCard } from "@/components/shared/stat-card";
import { LoanCostCards } from "@/modules/debts/components/loan-cost-cards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { splitPayment } from "@/domain/loan";
import { formatMoney, formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  previewPrepaymentAction,
  recordPaymentAction,
  recordPrepaymentAction,
} from "@/modules/debts/actions";
import { EditLoanDialog } from "@/modules/debts/components/edit-loan-dialog";
import type { DebtDetailDTO, PrepaymentPreviewDTO } from "@/modules/debts/schemas";
import {
  DipConfirmDialog,
  type DipConfirmation,
} from "@/modules/transactions/components/dip-confirm-dialog";
import type { ActionWarning } from "@/server/errors";

const fmtDate = (d: string | null) => (d ? format(parseISO(d), "d MMM yyyy") : "—");

function AccountPick({
  id,
  value,
  onChange,
  accounts,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  accounts: DebtDetailDTO["accounts"];
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(String(v ?? ""))}
      items={accounts.map((a) => ({ value: a.id, label: a.name }))}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            <span className="flex w-full justify-between gap-3">
              {a.name}
              <Money
                valueMinor={a.balanceMinor}
                currency={a.currency}
                className="text-muted-foreground"
                colorNegative={false}
              />
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PaymentDialog({
  d,
  today,
  onClose,
}: {
  d: DebtDetailDTO;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(
    Math.min(d.emiMinor, d.outstandingMinor + d.nextInterestMinor),
  );
  const [from, setFrom] = useState(d.paymentAccountId ?? d.accounts[0]?.id ?? "");
  const [date, setDate] = useState<string | null>(today);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ActionWarning[] | null>(null);
  const [pending, start] = useTransition();
  const split =
    amount && !Number.isNaN(amount)
      ? splitPayment(d.outstandingMinor, d.annualRateBp, amount)
      : null;

  async function submit(flags?: DipConfirmation) {
    const res = await recordPaymentAction(d.id, {
      date,
      amountMinor: amount ?? Number.NaN,
      fromAccountId: from,
      ...flags,
    });
    if (!res.ok) {
      if (res.error.code === "NEEDS_CONFIRMATION" && res.error.warnings)
        setWarnings(res.error.warnings);
      else setError(res.error.fieldErrors?.amountMinor?.[0] ?? res.error.message);
      return;
    }
    for (const w of res.data.warnings) toast.warning(w);
    toast.success("Payment recorded");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Interest on the outstanding is paid first; the rest reduces the loan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="pay-amount" label="Amount">
            <MoneyInput id="pay-amount" currency={d.currency} value={amount} onChange={setAmount} />
          </FormField>
          <FormField id="pay-from" label="Paid from">
            <AccountPick id="pay-from" value={from} onChange={setFrom} accounts={d.accounts} />
          </FormField>
          <FormField id="pay-date" label="Date">
            <DatePicker id="pay-date" value={date} onChange={setDate} />
          </FormField>
          {split ? (
            <dl className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
              <div className="flex justify-between">
                <dt>Interest (expense)</dt>
                <dd>
                  <Money valueMinor={split.interestMinor} currency={d.currency} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Principal (reduces the loan)</dt>
                <dd>
                  <Money valueMinor={split.principalMinor} currency={d.currency} />
                </dd>
              </div>
              {split.short ? (
                <dd className="text-xs text-destructive">
                  Less than this month’s interest: nothing goes to principal.
                </dd>
              ) : null}
              {amount! > d.emiMinor && !split.short ? (
                <dd className="text-xs text-muted-foreground">
                  Above the EMI: the extra prepays principal.
                </dd>
              ) : null}
            </dl>
          ) : null}
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
          <Button disabled={pending || !from} onClick={() => start(() => submit())}>
            {pending ? "Saving…" : "Record payment"}
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

function PrepaymentDialog({
  d,
  today,
  onClose,
}: {
  d: DebtDetailDTO;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(null);
  const [mode, setMode] = useState<"reduce_tenure" | "reduce_emi">("reduce_tenure");
  const [from, setFrom] = useState(d.paymentAccountId ?? d.accounts[0]?.id ?? "");
  const [date, setDate] = useState<string | null>(today);
  const [preview, setPreview] = useState<PrepaymentPreviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ActionWarning[] | null>(null);
  const [pending, start] = useTransition();

  function compare(nextAmount = amount, nextMode = mode) {
    if (!nextAmount || Number.isNaN(nextAmount)) {
      setPreview(null);
      return;
    }
    start(async () => {
      const res = await previewPrepaymentAction(d.id, { amountMinor: nextAmount, mode: nextMode });
      if (!res.ok) {
        setError(res.error.fieldErrors?.amountMinor?.[0] ?? res.error.message);
        setPreview(null);
        return;
      }
      setError(null);
      setPreview(res.data);
    });
  }

  async function submit(flags?: DipConfirmation) {
    const res = await recordPrepaymentAction(d.id, {
      date,
      amountMinor: amount ?? Number.NaN,
      fromAccountId: from,
      mode,
      ...flags,
    });
    if (!res.ok) {
      if (res.error.code === "NEEDS_CONFIRMATION" && res.error.warnings)
        setWarnings(res.error.warnings);
      else setError(res.error.message);
      return;
    }
    toast.success("Prepayment recorded");
    onClose();
    router.refresh();
  }

  const row = (label: string, a: React.ReactNode, b: React.ReactNode) => (
    <tr className="border-t">
      <th className="py-1.5 pr-3 text-left font-normal text-muted-foreground">{label}</th>
      <td className="py-1.5 pr-3 text-right">{a}</td>
      <td className="py-1.5 text-right font-medium">{b}</td>
    </tr>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prepayment</DialogTitle>
          <DialogDescription>
            Pays principal only. Choose whether to finish sooner or pay less each month.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="pre-amount" label="Amount">
            <MoneyInput
              id="pre-amount"
              currency={d.currency}
              value={amount}
              onChange={setAmount}
              onBlur={() => compare()}
            />
          </FormField>
          <div
            role="radiogroup"
            aria-label="After the prepayment"
            className="grid gap-2 sm:grid-cols-2"
          >
            {(
              [
                ["reduce_tenure", "Finish sooner", "Same EMI, fewer months"],
                ["reduce_emi", "Lower EMI", "Same end date, smaller EMI"],
              ] as const
            ).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => {
                  setMode(value);
                  compare(amount, value);
                }}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm",
                  mode === value && "border-primary bg-primary/5",
                )}
              >
                <span className="font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="pre-from" label="Paid from">
              <AccountPick id="pre-from" value={from} onChange={setFrom} accounts={d.accounts} />
            </FormField>
            <FormField id="pre-date" label="Date">
              <DatePicker id="pre-date" value={date} onChange={setDate} />
            </FormField>
          </div>
          <Button type="button" variant="outline" onClick={() => compare()} disabled={pending}>
            Compare before / after
          </Button>
          {preview ? (
            <table className="w-full text-sm" aria-label="Before and after the prepayment">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th />
                  <th className="pr-3 text-right font-medium">Now</th>
                  <th className="text-right font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {row(
                  "EMI",
                  <Money valueMinor={preview.before.emiMinor} currency={d.currency} />,
                  <Money valueMinor={preview.after.emiMinor} currency={d.currency} />,
                )}
                {row("Months left", preview.before.monthsLeft, preview.after.monthsLeft)}
                {row(
                  "Payoff",
                  fmtDate(preview.before.payoffDate),
                  fmtDate(preview.after.payoffDate),
                )}
                {row(
                  "Interest still to pay",
                  <Money valueMinor={preview.before.interestLeftMinor} currency={d.currency} />,
                  <Money valueMinor={preview.after.interestLeftMinor} currency={d.currency} />,
                )}
              </tbody>
            </table>
          ) : null}
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
          <Button disabled={pending || !from || !amount} onClick={() => start(() => submit())}>
            Record prepayment
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

interface Row {
  no: number | null;
  date: string;
  emiMinor: number;
  interestMinor: number;
  principalMinor: number;
  closingMinor: number | null;
  state: "before_tracking" | "paid" | "prepaid" | "projected";
}

// dataviz: two series → slots 1 (principal) and 2 (interest), stacked with a legend; values in ink.
const SERIES = [
  { key: "principalMinor", label: "Principal", color: "var(--viz-series-1)" },
  { key: "interestMinor", label: "Interest", color: "var(--viz-series-2)" },
] as const;

function SplitTooltip({ active, payload, currency }: TooltipContentProps & { currency: string }) {
  const p = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{fmtDate(p.date)}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{s.label}</span>
          <span className="font-semibold text-foreground tabular-nums">
            {formatMoney(p[s.key], currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DebtDetailClient({ d, today }: { d: DebtDetailDTO; today: string }) {
  const [dialog, setDialog] = useState<"pay" | "prepay" | "edit" | null>(null);
  const posted = d.payments.filter((p) => p.status === "posted");
  let n = d.paidBeforeTracking;
  const rows: Row[] = [
    ...d.schedule
      .filter((r) => r.state === "before_tracking")
      .map((r) => ({
        no: r.no,
        date: r.dueDate,
        emiMinor: r.emiMinor,
        interestMinor: r.interestMinor,
        principalMinor: r.principalMinor,
        closingMinor: r.closingMinor,
        state: "before_tracking" as const,
      })),
    ...posted.map((p) => ({
      no: p.prepayment ? null : ++n,
      date: p.date,
      emiMinor: p.amountMinor,
      interestMinor: p.interestMinor,
      principalMinor: p.principalMinor,
      closingMinor: null,
      state: p.prepayment ? ("prepaid" as const) : ("paid" as const),
    })),
    ...d.schedule
      .filter((r) => r.state === "projected")
      .map((r) => ({
        no: r.no,
        date: r.dueDate,
        emiMinor: r.emiMinor,
        interestMinor: r.interestMinor,
        principalMinor: r.principalMinor,
        closingMinor: r.closingMinor,
        state: "projected" as const,
      })),
  ];
  const active = d.status === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button disabled={!active} onClick={() => setDialog("pay")}>
          Record payment
        </Button>
        <Button variant="outline" disabled={!active} onClick={() => setDialog("prepay")}>
          Prepayment
        </Button>
        <Button variant="ghost" onClick={() => setDialog("edit")}>
          Edit loan
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Outstanding"
          value={<Money valueMinor={d.outstandingMinor} currency={d.currency} />}
          hint={`${formatPercentBp(d.progressBp)} of ${formatMoney(d.principalMinor, d.currency)} repaid`}
        />
        <StatCard
          label="EMI"
          value={<Money valueMinor={d.emiMinor} currency={d.currency} />}
          hint={`${formatPercentBp(d.annualRateBp)} a year · day ${d.paymentDay}`}
        />
        <StatCard label="Next due" value={active ? fmtDate(d.nextDueDate) : "Repaid"} />
        <StatCard label="Payoff" value={fmtDate(d.projectedPayoffDate)} />
        <LoanCostCards debt={d} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Principal vs interest</CardTitle>
          <CardDescription>Each instalment: early ones are mostly interest.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 rounded-sm"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.label}
              </li>
            ))}
          </ul>
          <figure aria-label="Principal and interest per instalment" className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows.filter((r) => r.state !== "prepaid")}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => format(parseISO(v), "MMM yy")}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    formatMoney(Math.round(v), d.currency, { compact: true })
                  }
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  content={(p) => <SplitTooltip {...p} currency={d.currency} />}
                />
                {SERIES.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="emi"
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={1}
                    radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </figure>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Amortisation schedule</CardTitle>
          <CardDescription>
            Paid instalments are ticked; the rest is the plan from today’s outstanding.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 text-right font-medium">Payment</th>
                <th className="py-2 pr-3 text-right font-medium">Interest</th>
                <th className="py-2 pr-3 text-right font-medium">Principal</th>
                <th className="py-2 pr-3 text-right font-medium">Balance after</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={cn("border-t", r.state === "projected" && "text-muted-foreground")}
                  data-state={r.state}
                >
                  <td className="py-1.5 pr-3 tabular-nums">{r.no ?? "—"}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="py-1.5 pr-3 text-right">
                    <Money valueMinor={r.emiMinor} currency={d.currency} />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <Money valueMinor={r.interestMinor} currency={d.currency} />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <Money valueMinor={r.principalMinor} currency={d.currency} />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {r.closingMinor === null ? (
                      "—"
                    ) : (
                      <Money valueMinor={r.closingMinor} currency={d.currency} />
                    )}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    {r.state === "projected" ? (
                      "Planned"
                    ) : (
                      <span className="flex items-center gap-1 text-foreground">
                        <Check className="size-4" aria-hidden />
                        {r.state === "before_tracking"
                          ? "Paid before tracking"
                          : r.state === "prepaid"
                            ? "Prepayment"
                            : "Paid"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {dialog === "pay" ? (
        <PaymentDialog d={d} today={today} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "edit" ? <EditLoanDialog d={d} onClose={() => setDialog(null)} /> : null}
      {dialog === "prepay" ? (
        <PrepaymentDialog d={d} today={today} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
