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
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { isLiability } from "@/domain/accounts";
import { reconcileAdjustment } from "@/domain/ledger";
import { reconcileAccountAction } from "@/modules/accounts/actions";
import type { AccountDTO } from "@/modules/accounts/schemas";

/** Reconcile (docs/04 §1): enter the real balance; the difference is posted as an adjustment. */
interface ReconcileProps {
  account: AccountDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayKey: string;
}

export function ReconcileDialog(props: ReconcileProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {props.open ? <ReconcileForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted fresh on every open, so its state starts from the current balance. */
function ReconcileForm({ account, onOpenChange, todayKey }: ReconcileProps) {
  const router = useRouter();
  const liability = isLiability(account.type);
  // Liabilities are entered as the amount owed (positive) and stored negative.
  const toDisplay = (balance: number) => (liability ? -balance : balance);
  const [actual, setActual] = React.useState<number | null>(toDisplay(account.balanceMinor));
  const [date, setDate] = React.useState<string | null>(todayKey);
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);

  const valid = actual !== null && !Number.isNaN(actual);
  const real = valid ? (liability ? -actual : actual) : null;
  const adj = real !== null ? reconcileAdjustment(account.balanceMinor, real) : null;
  const signed = adj ? (adj.direction === "to" ? adj.amountMinor : -adj.amountMinor) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (real === null || !date) {
      setError("Enter the actual balance");
      return;
    }
    setPending(true);
    const result = await reconcileAccountAction(account.id, { realBalanceMinor: real, date });
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.realBalanceMinor?.[0] ?? result.error.message);
      toast.error(result.error.message);
      return;
    }
    toast.success(result.data.adjustmentMinor === 0 ? "Already in balance" : "Balance adjusted");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reconcile {account.name}</DialogTitle>
        <DialogDescription>
          Enter what your statement or app shows. Any difference is recorded as a balance
          adjustment.
        </DialogDescription>
      </DialogHeader>
      <form id="reconcile-form" onSubmit={submit} noValidate className="grid gap-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {liability ? "Recorded owed" : "Recorded balance"}
          </span>
          <Money valueMinor={toDisplay(account.balanceMinor)} currency={account.currency} />
        </div>
        <FormField
          id="reconcile-actual"
          label={liability ? "Actual amount owed" : "Actual balance"}
          error={error}
        >
          <MoneyInput
            id="reconcile-actual"
            currency={account.currency}
            value={actual}
            onChange={setActual}
            autoFocus
            {...fieldAria("reconcile-actual", error)}
          />
        </FormField>
        <FormField id="reconcile-date" label="As of">
          <DatePicker id="reconcile-date" value={date} onChange={setDate} />
        </FormField>
        <div
          className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
          aria-live="polite"
        >
          <span>Adjustment</span>
          {adj ? (
            <Money valueMinor={signed} currency={account.currency} signed />
          ) : (
            <span className="text-muted-foreground">None — balances match</span>
          )}
        </div>
      </form>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" form="reconcile-form" disabled={pending || !valid}>
          {pending ? "Saving…" : "Reconcile"}
        </Button>
      </DialogFooter>
    </>
  );
}
