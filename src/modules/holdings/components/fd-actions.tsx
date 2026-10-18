"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { FD_COMPOUNDING, FD_PAYOUTS, fdMaturityValue } from "@/domain/fd";
import { formatMoney } from "@/lib/format";
import { renewFdAction, withdrawFdAction } from "@/modules/holdings/actions";
import type { HoldingDTO } from "@/modules/holdings/schemas";

const COMPOUNDING_LABEL = {
  simple: "Simple",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};
const PAYOUT_LABEL = { at_maturity: "At maturity", monthly: "Monthly", quarterly: "Quarterly" };

function addYear(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function AccountPicker({
  id,
  accounts,
  value,
  onChange,
}: {
  id: string;
  accounts: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
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
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** FD maturity actions (docs/04 §9): Withdraw (redeem whole deposit + close) or Renew. */
export function FdActions({
  holding,
  accounts,
  todayKey,
}: {
  holding: HoldingDTO;
  accounts: { id: string; name: string; currency: string }[];
  todayKey: string;
}) {
  const router = useRouter();
  const fd = holding.fd!;
  const usable = accounts.filter((a) => a.currency === holding.currency);
  const [mode, setMode] = React.useState<"withdraw" | "renew" | null>(null);
  const defaultDate = fd.daysToMaturity <= 0 ? fd.maturityDate : todayKey;
  const [date, setDate] = React.useState<string | null>(defaultDate);
  const [accountId, setAccountId] = React.useState(fd.payoutAccountId ?? usable[0]?.id ?? "");
  const [amount, setAmount] = React.useState<number | null>(
    fd.daysToMaturity <= 0 ? fd.maturityValueMinor : holding.currentValueMinor,
  );
  const [tax, setTax] = React.useState<number | null>(0);
  const [rate, setRate] = React.useState<number | null>(fd.rateBp);
  const [maturity, setMaturity] = React.useState<string | null>(addYear(defaultDate));
  const [compounding, setCompounding] = React.useState(fd.compounding);
  const [payout, setPayout] = React.useState(fd.payout);
  const [error, setError] = React.useState<string>();
  const [pending, setPending] = React.useState(false);

  const proceeds = (amount ?? 0) - (tax ?? 0);
  const renewPreview =
    mode === "renew" && proceeds > 0 && rate !== null && date && maturity && maturity > date
      ? fdMaturityValue({
          principalMinor: proceeds,
          rateBp: rate,
          startDate: date,
          maturityDate: maturity,
          compounding,
          payout,
        })
      : null;

  async function submit() {
    if (!date || !amount || !accountId) {
      setError("Fill in the date, amount and account");
      return;
    }
    setPending(true);
    const result =
      mode === "withdraw"
        ? await withdrawFdAction(holding.id, {
            date,
            toAccountId: accountId,
            amountMinor: amount,
            taxMinor: tax ?? 0,
          })
        : await renewFdAction(holding.id, {
            date,
            viaAccountId: accountId,
            amountMinor: amount,
            taxMinor: tax ?? 0,
            rateBp: rate ?? 0,
            maturityDate: maturity ?? "",
            compounding,
            payout,
          });
    setPending(false);
    if (!result.ok) {
      setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
      toast.error(result.error.message);
      return;
    }
    toast.success(mode === "withdraw" ? `${holding.name} withdrawn` : `${holding.name} renewed`);
    setMode(null);
    if (mode === "renew") router.push(`/assets/${result.data.id}`);
    else router.refresh();
  }

  if (holding.status !== "active") return null;
  return (
    <>
      <Button variant="outline" onClick={() => setMode("withdraw")}>
        Withdraw
      </Button>
      <Button variant="outline" onClick={() => setMode("renew")}>
        Renew
      </Button>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "withdraw" ? `Withdraw ${holding.name}` : `Renew ${holding.name}`}
            </DialogTitle>
            <DialogDescription>
              {mode === "withdraw"
                ? "Records the bank's payout as a full redemption and closes the deposit."
                : "Pays the maturity into the account and reinvests what arrived into a new deposit, as one linked operation."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField id="fd-date" label={mode === "withdraw" ? "Paid on" : "Renewed on"}>
              <DatePicker id="fd-date" value={date} onChange={setDate} />
            </FormField>
            <FormField
              id="fd-account"
              label={mode === "withdraw" ? "Paid into" : "Through account"}
            >
              <AccountPicker
                id="fd-account"
                accounts={usable}
                value={accountId}
                onChange={setAccountId}
              />
            </FormField>
            <FormField
              id="fd-amount"
              label="Gross amount paid by the bank"
              description={`Maturity value ${formatMoney(fd.maturityValueMinor, holding.currency)}`}
            >
              <MoneyInput
                id="fd-amount"
                currency={holding.currency}
                value={amount}
                onChange={setAmount}
                aria-describedby="fd-amount-description"
              />
            </FormField>
            <FormField id="fd-tax" label="Withholding tax">
              <MoneyInput id="fd-tax" currency={holding.currency} value={tax} onChange={setTax} />
            </FormField>
            {mode === "renew" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField id="fd-new-rate" label="New rate">
                    <PercentInput id="fd-new-rate" value={rate} onChange={setRate} />
                  </FormField>
                  <FormField id="fd-new-maturity" label="New maturity">
                    <DatePicker id="fd-new-maturity" value={maturity} onChange={setMaturity} />
                  </FormField>
                  <FormField id="fd-new-compounding" label="Interest">
                    <Select
                      value={compounding}
                      onValueChange={(v) => setCompounding(v as typeof compounding)}
                      items={FD_COMPOUNDING.map((c) => ({ value: c, label: COMPOUNDING_LABEL[c] }))}
                    >
                      <SelectTrigger id="fd-new-compounding" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FD_COMPOUNDING.map((c) => (
                          <SelectItem key={c} value={c}>
                            {COMPOUNDING_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField id="fd-new-payout" label="Interest paid">
                    <Select
                      value={payout}
                      onValueChange={(v) => setPayout(v as typeof payout)}
                      items={FD_PAYOUTS.map((p) => ({ value: p, label: PAYOUT_LABEL[p] }))}
                    >
                      <SelectTrigger id="fd-new-payout" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FD_PAYOUTS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PAYOUT_LABEL[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
                <div
                  className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm"
                  aria-live="polite"
                >
                  <span className="flex justify-between">
                    New principal{" "}
                    <Money valueMinor={Math.max(0, proceeds)} currency={holding.currency} />
                  </span>
                  {renewPreview !== null ? (
                    <span className="flex justify-between text-muted-foreground">
                      Value at new maturity{" "}
                      <Money valueMinor={renewPreview} currency={holding.currency} />
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div
                className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
                aria-live="polite"
              >
                <span>Cash into the account</span>
                <Money valueMinor={Math.max(0, proceeds)} currency={holding.currency} />
              </div>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={pending}>
              {pending ? "Saving…" : mode === "withdraw" ? "Withdraw" : "Renew"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
