"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { PriceInput, UnitsInput } from "@/components/shared/price-input";
import { FD_COMPOUNDING, FD_PAYOUTS, fdMaturityValue } from "@/domain/fd";
import { unitsValueMinor } from "@/domain/redemption";
import { vizColor } from "@/lib/viz-palette";
import { COMMON_CURRENCIES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { zodFieldErrors } from "@/server/action-result";
import { createHoldingAction } from "@/modules/holdings/actions";
import {
  INSTRUMENT_LABEL,
  LIQUIDITY_LABEL,
  UNIT_INSTRUMENTS,
} from "@/modules/holdings/components/holding-meta";
import {
  INSTRUMENT_TYPES,
  LIQUIDITY,
  type InstrumentType,
  type Liquidity,
} from "@/modules/holdings/constants";
import { createHoldingSchema } from "@/modules/holdings/schemas";

export interface AddHoldingOptions {
  classes: { id: string; name: string; color: string }[];
  accounts: { id: string; name: string; currency: string }[];
  baseCurrency: string;
  todayKey: string;
}

interface Draft {
  assetClassId: string;
  instrumentType: InstrumentType | "";
  name: string;
  currency: string;
  platform: string;
  symbol: string;
  liquidity: Liquidity;
  countsTowardEmergencyFund: boolean;
  trackUnits: boolean;
  openingDate: string | null;
  investedMinor: number | null;
  currentValueMinor: number | null;
  units: number | null;
  priceMinorE4: number | null;
  fdPrincipal: number | null;
  fdRateBp: number | null;
  fdStart: string | null;
  fdMaturity: string | null;
  fdCompounding: (typeof FD_COMPOUNDING)[number];
  fdPayout: (typeof FD_PAYOUTS)[number];
  fdPayoutAccountId: string;
}

const STEPS = ["Class", "Instrument", "Details", "Opening values"] as const;

const COMPOUNDING_LABEL = {
  simple: "Simple",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};
const PAYOUT_LABEL = { at_maturity: "At maturity", monthly: "Monthly", quarterly: "Quarterly" };

function emptyDraft(o: AddHoldingOptions): Draft {
  return {
    assetClassId: "",
    instrumentType: "",
    name: "",
    currency: o.baseCurrency,
    platform: "",
    symbol: "",
    liquidity: "medium",
    countsTowardEmergencyFund: false,
    trackUnits: false,
    openingDate: o.todayKey,
    investedMinor: null,
    currentValueMinor: null,
    units: null,
    priceMinorE4: null,
    fdPrincipal: null,
    fdRateBp: null,
    fdStart: o.todayKey,
    fdMaturity: null,
    fdCompounding: "simple",
    fdPayout: "at_maturity",
    fdPayoutAccountId: "",
  };
}

function toInput(d: Draft) {
  const base = {
    name: d.name,
    assetClassId: d.assetClassId,
    instrumentType: d.instrumentType,
    currency: d.currency,
    platform: d.platform,
    symbol: d.symbol,
    liquidity: d.liquidity,
    countsTowardEmergencyFund: d.countsTowardEmergencyFund,
  };
  if (d.instrumentType === "fd") {
    return {
      ...base,
      fd: {
        principalMinor: d.fdPrincipal ?? Number.NaN,
        rateBp: d.fdRateBp ?? Number.NaN,
        startDate: d.fdStart ?? "",
        maturityDate: d.fdMaturity ?? "",
        compounding: d.fdCompounding,
        payout: d.fdPayout,
        payoutAccountId: d.fdPayoutAccountId || null,
      },
    };
  }
  const tracked = d.trackUnits && d.units && d.priceMinorE4;
  return {
    ...base,
    trackUnits: d.trackUnits,
    openingDate: d.openingDate ?? "",
    investedMinor: d.investedMinor ?? Number.NaN,
    currentValueMinor: tracked
      ? unitsValueMinor(d.units!, d.priceMinorE4!)
      : (d.currentValueMinor ?? Number.NaN),
    ...(d.trackUnits ? { units: d.units, priceMinorE4: d.priceMinorE4 } : {}),
  };
}

/** Add holding wizard (docs/05 §5): class → instrument → details → opening values / FD terms. */
export function AddHoldingDialog({
  options,
  label = "Add holding",
}: {
  options: AddHoldingOptions;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [d, setD] = React.useState<Draft>(() => emptyDraft(options));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const isFd = d.instrumentType === "fd";
  const err = (k: string) => errors[k];

  function reset(o: boolean) {
    setOpen(o);
    if (o) {
      setStep(0);
      setD(emptyDraft(options));
      setErrors({});
    }
  }

  const canNext =
    (step === 0 && d.assetClassId) ||
    (step === 1 && d.instrumentType) ||
    (step === 2 && d.name.trim());

  async function submit() {
    const input = toInput(d);
    const parsed = createHoldingSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          Object.entries(zodFieldErrors(parsed.error)).map(([k, v]) => [k, v[0] ?? ""]),
        ),
      );
      return;
    }
    setPending(true);
    const result = await createHoldingAction(input);
    setPending(false);
    if (!result.ok) {
      setErrors(
        Object.fromEntries(
          Object.entries(result.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""]),
        ),
      );
      toast.error(result.error.message);
      return;
    }
    toast.success(`${result.data.name} added`);
    setOpen(false);
    router.push(`/assets/${result.data.id}`);
  }

  const maturityPreview =
    isFd &&
    d.fdPrincipal &&
    d.fdRateBp !== null &&
    d.fdStart &&
    d.fdMaturity &&
    d.fdMaturity > d.fdStart
      ? fdMaturityValue({
          principalMinor: d.fdPrincipal,
          rateBp: d.fdRateBp,
          startDate: d.fdStart,
          maturityDate: d.fdMaturity,
          compounding: d.fdCompounding,
          payout: d.fdPayout,
        })
      : null;

  return (
    <>
      <Button onClick={() => reset(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add holding</DialogTitle>
            <DialogDescription>
              Step {step + 1} of {STEPS.length}: {STEPS[step]}
            </DialogDescription>
          </DialogHeader>
          <ol className="flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")}
              />
            ))}
          </ol>

          {step === 0 ? (
            <div role="radiogroup" aria-label="Asset class" className="grid grid-cols-2 gap-2">
              {options.classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={d.assetClassId === c.id}
                  onClick={() => set("assetClassId", c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    d.assetClassId === c.id && "border-primary bg-primary/5",
                  )}
                >
                  <span
                    className="size-3 rounded-full"
                    style={{ background: vizColor(c.color) }}
                    aria-hidden
                  />
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}

          {step === 1 ? (
            <div role="radiogroup" aria-label="Instrument" className="grid grid-cols-2 gap-2">
              {INSTRUMENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={d.instrumentType === t}
                  onClick={() => {
                    set("instrumentType", t);
                    set("trackUnits", UNIT_INSTRUMENTS.includes(t) ? d.trackUnits : false);
                  }}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    d.instrumentType === t && "border-primary bg-primary/5",
                  )}
                >
                  {INSTRUMENT_LABEL[t]}
                </button>
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormField id="h-name" label="Name" error={err("name")}>
                  <Input
                    id="h-name"
                    value={d.name}
                    onChange={(e) => set("name", e.target.value)}
                    autoFocus
                    {...fieldAria("h-name", err("name"))}
                  />
                </FormField>
              </div>
              <FormField id="h-currency" label="Currency" error={err("currency")}>
                <Select value={d.currency} onValueChange={(v) => set("currency", String(v))}>
                  <SelectTrigger id="h-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set([options.baseCurrency, ...COMMON_CURRENCIES])).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="h-liquidity" label="Liquidity">
                <Select
                  value={d.liquidity}
                  onValueChange={(v) => set("liquidity", v as Liquidity)}
                  items={LIQUIDITY.map((l) => ({ value: l, label: LIQUIDITY_LABEL[l] }))}
                >
                  <SelectTrigger id="h-liquidity" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIQUIDITY.map((l) => (
                      <SelectItem key={l} value={l}>
                        {LIQUIDITY_LABEL[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                id="h-platform"
                label={isFd ? "Bank (optional)" : "Platform / broker (optional)"}
              >
                <Input
                  id="h-platform"
                  value={d.platform}
                  onChange={(e) => set("platform", e.target.value)}
                />
              </FormField>
              {!isFd ? (
                <FormField id="h-symbol" label="Symbol (optional)">
                  <Input
                    id="h-symbol"
                    value={d.symbol}
                    onChange={(e) => set("symbol", e.target.value)}
                  />
                </FormField>
              ) : null}
              {d.instrumentType && UNIT_INSTRUMENTS.includes(d.instrumentType) ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                  <Label htmlFor="h-track">Track units and price</Label>
                  <Switch
                    id="h-track"
                    checked={d.trackUnits}
                    onCheckedChange={(c) => set("trackUnits", c)}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                <Label htmlFor="h-emergency">Counts toward emergency fund</Label>
                <Switch
                  id="h-emergency"
                  checked={d.countsTowardEmergencyFund}
                  onCheckedChange={(c) => set("countsTowardEmergencyFund", c)}
                />
              </div>
            </div>
          ) : null}

          {step === 3 && isFd ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="fd-principal" label="Principal" error={err("fd.principalMinor")}>
                <MoneyInput
                  id="fd-principal"
                  currency={d.currency}
                  value={d.fdPrincipal}
                  onChange={(v) => set("fdPrincipal", v)}
                  {...fieldAria("fd-principal", err("fd.principalMinor"))}
                />
              </FormField>
              <FormField id="fd-rate" label="Annual rate" error={err("fd.rateBp")}>
                <PercentInput
                  id="fd-rate"
                  value={d.fdRateBp}
                  onChange={(v) => set("fdRateBp", v)}
                  {...fieldAria("fd-rate", err("fd.rateBp"))}
                />
              </FormField>
              <FormField id="fd-start" label="Start date" error={err("fd.startDate")}>
                <DatePicker id="fd-start" value={d.fdStart} onChange={(v) => set("fdStart", v)} />
              </FormField>
              <FormField id="fd-maturity" label="Maturity date" error={err("fd.maturityDate")}>
                <DatePicker
                  id="fd-maturity"
                  value={d.fdMaturity}
                  onChange={(v) => set("fdMaturity", v)}
                  aria-invalid={Boolean(err("fd.maturityDate"))}
                />
              </FormField>
              <FormField id="fd-compounding" label="Interest">
                <Select
                  value={d.fdCompounding}
                  onValueChange={(v) => set("fdCompounding", v as Draft["fdCompounding"])}
                  items={FD_COMPOUNDING.map((c) => ({ value: c, label: COMPOUNDING_LABEL[c] }))}
                >
                  <SelectTrigger id="fd-compounding" className="w-full">
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
              <FormField id="fd-payout" label="Interest paid">
                <Select
                  value={d.fdPayout}
                  onValueChange={(v) => set("fdPayout", v as Draft["fdPayout"])}
                  items={FD_PAYOUTS.map((p) => ({ value: p, label: PAYOUT_LABEL[p] }))}
                >
                  <SelectTrigger id="fd-payout" className="w-full">
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
              {d.fdPayout !== "at_maturity" ? (
                <div className="sm:col-span-2">
                  <FormField id="fd-payout-account" label="Interest paid into">
                    <Select
                      value={d.fdPayoutAccountId}
                      onValueChange={(v) => set("fdPayoutAccountId", String(v ?? ""))}
                      items={options.accounts.map((a) => ({ value: a.id, label: a.name }))}
                    >
                      <SelectTrigger id="fd-payout-account" className="w-full">
                        <SelectValue placeholder="Choose an account" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.accounts
                          .filter((a) => a.currency === d.currency)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              ) : null}
              {maturityPreview !== null ? (
                <div
                  className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2"
                  aria-live="polite"
                >
                  <span>Value at maturity</span>
                  <Money valueMinor={maturityPreview} currency={d.currency} />
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 && !isFd ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FormField
                  id="h-opening-date"
                  label="As of"
                  error={err("openingDate")}
                  description="The date these amounts apply to."
                >
                  <DatePicker
                    id="h-opening-date"
                    value={d.openingDate}
                    onChange={(v) => set("openingDate", v)}
                  />
                </FormField>
              </div>
              <FormField
                id="h-invested"
                label="Amount invested"
                error={err("investedMinor")}
                description="Total you put in, incl. fees."
              >
                <MoneyInput
                  id="h-invested"
                  currency={d.currency}
                  value={d.investedMinor}
                  onChange={(v) => set("investedMinor", v)}
                  {...fieldAria("h-invested", err("investedMinor"), true)}
                />
              </FormField>
              {d.trackUnits ? (
                <>
                  <FormField id="h-units" label="Units held" error={err("units")}>
                    <UnitsInput
                      id="h-units"
                      value={d.units}
                      onChange={(v) => set("units", v)}
                      {...fieldAria("h-units", err("units"))}
                    />
                  </FormField>
                  <FormField id="h-price" label="Current price (NAV)" error={err("priceMinorE4")}>
                    <PriceInput
                      id="h-price"
                      currency={d.currency}
                      value={d.priceMinorE4}
                      onChange={(v) => set("priceMinorE4", v)}
                    />
                  </FormField>
                  {d.units && d.priceMinorE4 ? (
                    <div
                      className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
                      aria-live="polite"
                    >
                      <span>Current value</span>
                      <Money
                        valueMinor={unitsValueMinor(d.units, d.priceMinorE4)}
                        currency={d.currency}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <FormField id="h-value" label="Current value" error={err("currentValueMinor")}>
                  <MoneyInput
                    id="h-value"
                    currency={d.currency}
                    value={d.currentValueMinor}
                    onChange={(v) => set("currentValueMinor", v)}
                    {...fieldAria("h-value", err("currentValueMinor"))}
                  />
                </FormField>
              )}
            </div>
          ) : null}

          {errors._form || errors.fd ? (
            <p role="alert" className="text-sm text-destructive">
              {errors._form ?? errors.fd}
            </p>
          ) : null}

          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0 || pending}
            >
              <ArrowLeft aria-hidden /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                Next
              </Button>
            ) : (
              <Button onClick={() => void submit()} disabled={pending}>
                {pending ? "Adding…" : "Add holding"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
