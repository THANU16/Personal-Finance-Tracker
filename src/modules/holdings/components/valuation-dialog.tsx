"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PriceInput } from "@/components/shared/price-input";
import { isBigChange } from "@/domain/holdings";
import { unitsValueMinor } from "@/domain/redemption";
import { formatPercentBp, formatUnits } from "@/lib/format";
import { recordValuationAction } from "@/modules/holdings/actions";

export interface ValuationTarget {
  id: string;
  name: string;
  currency: string;
  currentValueMinor: number;
  trackUnits: boolean;
  units: number | null;
  lastPriceMinorE4: number | null;
}

/** Update value (docs/04 §12): a change above the threshold needs an explicit tick. */
export function ValuationDialog({
  holding,
  open,
  onOpenChange,
  todayKey,
  bigChangeThresholdBp,
}: {
  holding: ValuationTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayKey: string;
  bigChangeThresholdBp: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <ValuationForm
            holding={holding}
            onDone={() => onOpenChange(false)}
            todayKey={todayKey}
            bigChangeThresholdBp={bigChangeThresholdBp}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ValuationForm({
  holding,
  onDone,
  todayKey,
  bigChangeThresholdBp,
}: {
  holding: ValuationTarget;
  onDone: () => void;
  todayKey: string;
  bigChangeThresholdBp: number;
}) {
  const router = useRouter();
  const byPrice = holding.trackUnits && holding.units !== null;
  const [date, setDate] = React.useState<string | null>(todayKey);
  const [value, setValue] = React.useState<number | null>(
    byPrice ? null : holding.currentValueMinor,
  );
  const [price, setPrice] = React.useState<number | null>(holding.lastPriceMinorE4);
  const [confirm, setConfirm] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const newValue =
    byPrice && price && !Number.isNaN(price) ? unitsValueMinor(holding.units!, price) : value;
  const valid = newValue !== null && !Number.isNaN(newValue);
  const big = valid && isBigChange(holding.currentValueMinor, newValue, bigChangeThresholdBp);
  const changeBp =
    valid && holding.currentValueMinor > 0
      ? Math.round(((newValue - holding.currentValueMinor) * 10_000) / holding.currentValueMinor)
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !date) return;
    setPending(true);
    const result = await recordValuationAction(holding.id, {
      date,
      ...(byPrice ? { priceMinorE4: price } : { valueMinor: value }),
      confirmBigChange: confirm,
    });
    setPending(false);
    if (!result.ok) {
      const fe = result.error.fieldErrors ?? {};
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ""])));
      toast.error(result.error.message);
      return;
    }
    toast.success(`${holding.name} updated`);
    onDone();
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update value · {holding.name}</DialogTitle>
        <DialogDescription>
          {byPrice
            ? `Enter today's NAV/price; value = ${formatUnits(holding.units!)} units × price.`
            : "Enter what the holding is worth now."}
        </DialogDescription>
      </DialogHeader>
      <form id="valuation-form" onSubmit={submit} noValidate className="grid gap-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Current value</span>
          <Money valueMinor={holding.currentValueMinor} currency={holding.currency} />
        </div>
        {byPrice ? (
          <FormField
            id="val-price"
            label="Price per unit (NAV)"
            error={errors.priceMinorE4 ?? errors.valueMinor}
          >
            <PriceInput
              id="val-price"
              currency={holding.currency}
              value={price}
              onChange={setPrice}
              autoFocus
              {...fieldAria("val-price", errors.priceMinorE4)}
            />
          </FormField>
        ) : (
          <FormField id="val-value" label="New value" error={errors.valueMinor}>
            <MoneyInput
              id="val-value"
              currency={holding.currency}
              value={value}
              onChange={setValue}
              autoFocus
              {...fieldAria("val-value", errors.valueMinor)}
            />
          </FormField>
        )}
        <FormField id="val-date" label="As of" error={errors.date}>
          <DatePicker id="val-date" value={date} onChange={setDate} />
        </FormField>
        <div
          className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
          aria-live="polite"
        >
          <span>New value</span>
          {valid ? (
            <span className="flex items-center gap-2">
              <Money valueMinor={newValue} currency={holding.currency} />
              {changeBp !== null ? (
                <span className="text-xs text-muted-foreground">
                  ({formatPercentBp(changeBp, { signed: true })})
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        {big ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <Checkbox
              id="val-confirm"
              checked={confirm}
              onCheckedChange={(c) => setConfirm(c === true)}
            />
            <Label htmlFor="val-confirm" className="leading-snug font-normal">
              This changes the value by more than {formatPercentBp(bigChangeThresholdBp)}. I confirm
              it is right.
            </Label>
          </div>
        ) : null}
        {errors.confirmBigChange ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.confirmBigChange}
          </p>
        ) : null}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="valuation-form"
          disabled={pending || !valid || (big && !confirm)}
        >
          {pending ? "Saving…" : "Save value"}
        </Button>
      </DialogFooter>
    </>
  );
}
