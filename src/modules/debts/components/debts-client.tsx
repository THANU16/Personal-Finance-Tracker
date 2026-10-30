"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emiMinor } from "@/domain/loan";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createDebtAction, settleCounterpartyAction } from "@/modules/debts/actions";
import type { CounterpartyDTO, DebtsOverviewDTO } from "@/modules/debts/schemas";
import {
  DipConfirmDialog,
  type DipConfirmation,
} from "@/modules/transactions/components/dip-confirm-dialog";
import type { ActionWarning } from "@/server/errors";
import { stackOnPhone } from "@/components/shared/mobile/stack-table";

const KIND_LABEL = {
  bank_loan: "Bank loan",
  leasing: "Leasing",
  personal: "Personal",
  other: "Other",
} as const;
const NONE = "__none";
const fmtDate = (d: string | null) => (d ? format(parseISO(d), "d MMM yyyy") : "—");

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

/** DTI chip: ≤ 30% healthy, ≤ 50% watch, above that high (icon-free text, never colour alone). */
function DtiChip({ bp }: { bp: number | null }) {
  if (bp === null) return <Badge variant="outline">DTI: no income yet</Badge>;
  const label = bp <= 3000 ? "healthy" : bp <= 5000 ? "watch" : "high";
  return (
    <Badge variant={bp > 5000 ? "destructive" : bp > 3000 ? "outline" : "secondary"}>
      DTI {formatPercentBp(bp)} · {label}
    </Badge>
  );
}

function AddLoanDialog({ data }: { data: DebtsOverviewDTO }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState(false);
  const [f, setF] = useState({
    name: "",
    kind: "bank_loan",
    lender: "",
    principalMinor: null as number | null,
    annualRateBp: null as number | null,
    tenureMonths: "",
    startDate: data.todayKey as string | null,
    paymentDay: "",
    paymentAccountId: data.accounts[0]?.id ?? NONE,
    receivedIntoAccountId: NONE,
    paidBeforeTracking: "0",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const months = Number(f.tenureMonths);
  const preview =
    f.principalMinor && f.annualRateBp !== null && Number.isInteger(months) && months > 0
      ? emiMinor(f.principalMinor, f.annualRateBp, months)
      : null;
  const err = (k: string) => errors[k]?.[0];
  const accountOptions = data.accounts.map((a) => ({
    value: a.id,
    label: `${a.name} · ${a.currency}`,
  }));

  function submit() {
    start(async () => {
      const res = await createDebtAction({
        name: f.name,
        kind: f.kind,
        lender: f.lender,
        principalMinor: f.principalMinor ?? Number.NaN,
        annualRateBp: f.annualRateBp ?? Number.NaN,
        tenureMonths: Number(f.tenureMonths || Number.NaN),
        startDate: f.startDate ?? "",
        paymentDay: Number(
          f.paymentDay || (f.startDate ? Number(f.startDate.slice(8)) : Number.NaN),
        ),
        paymentAccountId: f.paymentAccountId === NONE ? null : f.paymentAccountId,
        receivedIntoAccountId:
          existing || f.receivedIntoAccountId === NONE ? null : f.receivedIntoAccountId,
        paidBeforeTracking: existing ? Number(f.paidBeforeTracking || 0) : 0,
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success(`${f.name} added`);
      setOpen(false);
      router.push(`/debts/${res.data.id}`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add loan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add loan</DialogTitle>
            <DialogDescription>
              Creates a loan account (what you owe shows below zero) and its repayment plan.
            </DialogDescription>
          </DialogHeader>
          <div
            className="flex gap-1 rounded-lg bg-muted p-0.5 text-sm"
            role="radiogroup"
            aria-label="Loan status"
          >
            {[
              [false, "New loan"],
              [true, "Already paying"],
            ].map(([v, label]) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={existing === v}
                onClick={() => setExisting(v as boolean)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1 max-md:min-h-11",
                  existing === v && "bg-background font-medium shadow-sm",
                )}
              >
                {label as string}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField id="loan-name" label="Name" error={err("name")}>
                <Input
                  id="loan-name"
                  value={f.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </FormField>
            </div>
            <FormField id="loan-kind" label="Kind">
              <Pick
                id="loan-kind"
                value={f.kind}
                onChange={(v) => set("kind", v)}
                options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
              />
            </FormField>
            <FormField id="loan-lender" label="Lender (optional)">
              <Input
                id="loan-lender"
                value={f.lender}
                onChange={(e) => set("lender", e.target.value)}
              />
            </FormField>
            <FormField id="loan-principal" label="Loan amount" error={err("principalMinor")}>
              <MoneyInput
                id="loan-principal"
                currency={data.baseCurrency}
                value={f.principalMinor}
                onChange={(v) => set("principalMinor", v)}
              />
            </FormField>
            <FormField id="loan-rate" label="Annual interest rate" error={err("annualRateBp")}>
              <PercentInput
                id="loan-rate"
                value={f.annualRateBp}
                onChange={(v) => set("annualRateBp", v)}
              />
            </FormField>
            <FormField id="loan-tenure" label="Tenure (months)" error={err("tenureMonths")}>
              <Input
                id="loan-tenure"
                inputMode="numeric"
                value={f.tenureMonths}
                onChange={(e) => set("tenureMonths", e.target.value)}
              />
            </FormField>
            <FormField id="loan-start" label="Start date" error={err("startDate")}>
              <DatePicker
                id="loan-start"
                value={f.startDate}
                onChange={(v) => set("startDate", v)}
              />
            </FormField>
            <FormField
              id="loan-day"
              label="Payment day (1–31)"
              error={err("paymentDay")}
              description="Defaults to the start date's day"
            >
              <Input
                id="loan-day"
                inputMode="numeric"
                value={f.paymentDay}
                onChange={(e) => set("paymentDay", e.target.value)}
              />
            </FormField>
            <FormField id="loan-pay-from" label="EMIs paid from">
              <Pick
                id="loan-pay-from"
                value={f.paymentAccountId}
                onChange={(v) => set("paymentAccountId", v)}
                options={[{ value: NONE, label: "Not set" }, ...accountOptions]}
              />
            </FormField>
            {existing ? (
              <FormField
                id="loan-paid"
                label="Instalments already paid"
                error={err("paidBeforeTracking")}
              >
                <Input
                  id="loan-paid"
                  inputMode="numeric"
                  value={f.paidBeforeTracking}
                  onChange={(e) => set("paidBeforeTracking", e.target.value)}
                />
              </FormField>
            ) : (
              <FormField
                id="loan-received"
                label="Money received into (optional)"
                error={err("receivedIntoAccountId")}
              >
                <Pick
                  id="loan-received"
                  value={f.receivedIntoAccountId}
                  onChange={(v) => set("receivedIntoAccountId", v)}
                  options={[{ value: NONE, label: "Not recorded" }, ...accountOptions]}
                />
              </FormField>
            )}
          </div>
          {preview !== null ? (
            <div
              className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
              aria-live="polite"
            >
              <span>Monthly instalment (EMI)</span>
              <Money valueMinor={preview} currency={data.baseCurrency} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Adding…" : "Add loan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettleDialog({
  cp,
  data,
  onClose,
}: {
  cp: CounterpartyDTO;
  data: DebtsOverviewDTO;
  onClose: () => void;
}) {
  const router = useRouter();
  const open = Math.abs(cp.balanceMinor);
  const accounts = data.accounts.filter((a) => a.currency === cp.currency);
  const [amount, setAmount] = useState<number | null>(open);
  const [other, setOther] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState<string | null>(data.todayKey);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ActionWarning[] | null>(null);
  const [pending, start] = useTransition();
  const owedToMe = cp.balanceMinor > 0;

  async function submit(flags?: DipConfirmation) {
    const res = await settleCounterpartyAction({
      accountId: cp.id,
      otherAccountId: other,
      amountMinor: amount ?? Number.NaN,
      date,
      ...flags,
    });
    if (!res.ok) {
      if (res.error.code === "NEEDS_CONFIRMATION" && res.error.warnings)
        setWarnings(res.error.warnings);
      else setError(res.error.message);
      return;
    }
    toast.success(`${cp.name} settled`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settle {cp.name}</DialogTitle>
          <DialogDescription>
            {owedToMe
              ? "Money you are owed comes back into an account."
              : "You pay what you owe from an account."}{" "}
            Open balance <Money valueMinor={open} currency={cp.currency} />.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="settle-amount" label="Amount">
            <MoneyInput
              id="settle-amount"
              currency={cp.currency}
              value={amount}
              onChange={setAmount}
            />
          </FormField>
          <FormField id="settle-account" label={owedToMe ? "Received into" : "Paid from"}>
            <Pick
              id="settle-account"
              value={other}
              onChange={setOther}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
          </FormField>
          <FormField id="settle-date" label="Date">
            <DatePicker id="settle-date" value={date} onChange={setDate} />
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
          <Button disabled={pending || !other} onClick={() => start(() => submit())}>
            Settle
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

export function DebtsClient({ data }: { data: DebtsOverviewDTO }) {
  const [settling, setSettling] = useState<CounterpartyDTO | null>(null);
  const ccy = data.baseCurrency;
  const active = data.debts.filter((d) => d.status === "active");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DtiChip bp={data.dtiBp} />
        <AddLoanDialog data={data} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total owed"
          value={<Money valueMinor={data.totals.outstandingMinor} currency={ccy} />}
          hint={`${active.length} active loan${active.length === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Monthly EMIs"
          value={<Money valueMinor={data.totals.monthlyEmiMinor} currency={ccy} />}
        />
        <StatCard
          label="Debt-to-income"
          value={data.dtiBp === null ? "—" : formatPercentBp(data.dtiBp)}
          hint={
            data.avgMonthlyIncomeMinor > 0 ? (
              <>
                of <Money valueMinor={data.avgMonthlyIncomeMinor} currency={ccy} /> average monthly
                income
              </>
            ) : (
              "Needs income in the last 3 months"
            )
          }
        />
      </div>

      {data.debts.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Loans</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className={cn("w-full text-sm", stackOnPhone)}>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Loan</th>
                  <th className="py-2 pr-3 text-right font-medium">Outstanding</th>
                  <th className="py-2 pr-3 text-right font-medium">EMI</th>
                  <th className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th className="py-2 pr-3 font-medium">Next due</th>
                  <th className="py-2 pr-3 font-medium">Payoff</th>
                  <th className="py-2 font-medium">Repaid</th>
                </tr>
              </thead>
              <tbody>
                {data.debts.map((d) => (
                  <tr
                    key={d.id}
                    className={cn("border-t", d.status === "closed" && "text-muted-foreground")}
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/debts/${d.id}`}
                        className="font-medium hover:underline max-md:-my-3.5 max-md:py-3.5"
                      >
                        {d.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {KIND_LABEL[d.kind]}
                        {d.lender ? ` · ${d.lender}` : ""}
                        {d.status === "closed" ? " · repaid" : ""}
                      </span>
                    </td>
                    <td data-label="Outstanding" className="py-2 pr-3 text-right">
                      <Money valueMinor={d.outstandingMinor} currency={d.currency} />
                    </td>
                    <td data-label="EMI" className="py-2 pr-3 text-right">
                      <Money valueMinor={d.emiMinor} currency={d.currency} />
                    </td>
                    <td data-label="Rate" className="py-2 pr-3 text-right">
                      {formatPercentBp(d.annualRateBp)}
                    </td>
                    <td data-label="Next due" className="py-2 pr-3 whitespace-nowrap">
                      {fmtDate(d.nextDueDate)}
                    </td>
                    <td data-label="Payoff" className="py-2 pr-3 whitespace-nowrap">
                      {fmtDate(d.projectedPayoffDate)}
                    </td>
                    <td data-label="Repaid" className="w-40 py-2">
                      <div
                        className="h-2 rounded-full bg-muted"
                        role="img"
                        aria-label={`${formatPercentBp(d.progressBp)} repaid`}
                      >
                        <div
                          className="h-2 rounded-full bg-[var(--viz-series-1)]"
                          style={{ width: `${d.progressBp / 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatPercentBp(d.progressBp)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="No loans"
          description="Add a bank loan, leasing or personal loan to track its EMI, schedule and payoff date."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Receivables & payables</CardTitle>
          <CardDescription>
            Money lent to others and money you owe people. Settling records a transfer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.counterparties.length ? (
            <ul className="divide-y">
              {data.counterparties.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.type === "receivable" ? "Owed to you" : "You owe"}
                      {c.counterparty ? ` · ${c.counterparty}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money valueMinor={Math.abs(c.balanceMinor)} currency={c.currency} />
                    <Button size="sm" variant="outline" onClick={() => setSettling(c)}>
                      Settle
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing open. Add a Receivable or Payable account under Accounts to track one.
            </p>
          )}
        </CardContent>
      </Card>
      {settling ? (
        <SettleDialog cp={settling} data={data} onClose={() => setSettling(null)} />
      ) : null}
    </div>
  );
}
