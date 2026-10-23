"use client";

import Link from "next/link";
import { Controller, type Control } from "react-hook-form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PriceInput, UnitsInput } from "@/components/shared/price-input";
import { redeemByAmount, redeemByUnits, type RedemptionResult } from "@/domain/redemption";
import { formatPrice, formatUnits } from "@/lib/format";
import type { HoldingOption } from "@/modules/holdings/queries";
import type { QuickAddType } from "@/modules/transactions/components/quick-add-context";

export type IncomeKind = "dividend" | "interest" | "distribution" | "rent" | "other";

/** Values of the Quick add form (all tabs share one form). */
export interface QuickAddFormValues {
  type: QuickAddType;
  date: string;
  amountMinor: number | null;
  fromAccountId: string;
  toAccountId: string;
  toAmountMinor: number | null;
  categoryId: string;
  splitMode: boolean;
  splits: { categoryId: string; amountMinor: number | null }[];
  description: string;
  counterparty: string;
  tags: string;
  notes: string;
  holdingId: string;
  feeMinor: number | null;
  taxMinor: number | null;
  units: number | null;
  priceMinorE4: number | null;
  redeemBy: "amount" | "units";
  incomeKind: IncomeKind;
  reinvest: boolean;
  /** Optional bucket tags; "" = normal (free cash). */
  fromBucket: "" | "emergency" | "opportunity";
  toBucket: "" | "emergency" | "opportunity";
}

type QuickAddControl = Control<QuickAddFormValues>;

const INCOME_KINDS = [
  { value: "dividend", label: "Dividend" },
  { value: "interest", label: "Interest" },
  { value: "distribution", label: "Distribution" },
  { value: "rent", label: "Rent" },
  { value: "other", label: "Other" },
] as const;

/** Holding picker + (redeem) amount/units switch + stale warning. */
export function InvestmentHeader({
  control,
  type,
  holdings,
  holding,
  err,
  onDone,
}: {
  control: QuickAddControl;
  type: string;
  holdings: HoldingOption[];
  holding: HoldingOption | undefined;
  err: (path: string) => string | undefined;
  onDone: () => void;
}) {
  if (holdings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a holding first.{" "}
        <Link
          href="/assets"
          onClick={onDone}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Go to Assets
        </Link>
      </p>
    );
  }
  return (
    <>
      <FormField id="qa-holding" label="Holding" error={err("holdingId")}>
        <Controller
          control={control}
          name="holdingId"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(v) => field.onChange(String(v ?? ""))}
              items={holdings.map((h) => ({ value: h.id, label: `${h.name} · ${h.currency}` }))}
            >
              <SelectTrigger
                id="qa-holding"
                className="w-full"
                aria-invalid={Boolean(err("holdingId"))}
              >
                <SelectValue placeholder="Choose a holding" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {holdings.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    <span className="flex w-full justify-between gap-4">
                      <span>{h.name}</span>
                      <Money
                        valueMinor={h.currentValueMinor}
                        currency={h.currency}
                        className="text-muted-foreground"
                      />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      {type === "redeem" && holding?.trackUnits && holding.units ? (
        <Controller
          control={control}
          name="redeemBy"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={(v) => field.onChange(v)}>
              <TabsList className="w-full">
                <TabsTrigger value="amount">By amount</TabsTrigger>
                <TabsTrigger value="units">By units</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        />
      ) : null}
      {type === "redeem" && holding?.stale ? (
        <p
          role="status"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
        >
          This value is stale — the gain uses the last recorded value.{" "}
          <Link
            href={`/assets/${holding.id}`}
            onClick={onDone}
            className="font-medium underline underline-offset-4"
          >
            Update the value first
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}

/** Fee / tax / units / price / income kind / reinvest, depending on the type. */
export function InvestmentFields({
  control,
  type,
  currency,
  holding,
  byUnits,
  reinvest,
  err,
}: {
  control: QuickAddControl;
  type: string;
  currency: string;
  holding: HoldingOption | undefined;
  byUnits: boolean;
  reinvest: boolean;
  err: (path: string) => string | undefined;
}) {
  const tracked = Boolean(holding?.trackUnits);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {byUnits ? (
        <>
          <FormField
            id="qa-units"
            label="Units sold"
            error={err("units")}
            description={
              holding?.units != null ? `Holding ${formatUnits(holding.units)}` : undefined
            }
          >
            <Controller
              control={control}
              name="units"
              render={({ field }) => (
                <UnitsInput
                  id="qa-units"
                  value={field.value}
                  onChange={field.onChange}
                  {...fieldAria("qa-units", err("units"), true)}
                />
              )}
            />
          </FormField>
          <FormField
            id="qa-price"
            label="Price per unit"
            error={err("priceMinorE4")}
            description={
              holding?.lastPriceMinorE4
                ? `Last ${formatPrice(holding.lastPriceMinorE4, currency)}`
                : undefined
            }
          >
            <Controller
              control={control}
              name="priceMinorE4"
              render={({ field }) => (
                <PriceInput
                  id="qa-price"
                  currency={currency}
                  value={field.value}
                  onChange={field.onChange}
                  {...fieldAria("qa-price", err("priceMinorE4"), true)}
                />
              )}
            />
          </FormField>
        </>
      ) : null}
      {type === "invest" && tracked ? (
        <>
          <FormField id="qa-units" label="Units bought (optional)" error={err("units")}>
            <Controller
              control={control}
              name="units"
              render={({ field }) => (
                <UnitsInput id="qa-units" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField
            id="qa-price"
            label="Price per unit (optional)"
            error={err("priceMinorE4")}
            description="Enter one; the other is worked out."
          >
            <Controller
              control={control}
              name="priceMinorE4"
              render={({ field }) => (
                <PriceInput
                  id="qa-price"
                  currency={currency}
                  value={field.value}
                  onChange={field.onChange}
                  aria-describedby="qa-price-description"
                />
              )}
            />
          </FormField>
        </>
      ) : null}
      {type === "invest" || type === "redeem" ? (
        <FormField id="qa-fee" label="Fee" error={err("feeMinor")}>
          <Controller
            control={control}
            name="feeMinor"
            render={({ field }) => (
              <MoneyInput
                id="qa-fee"
                currency={currency}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FormField>
      ) : null}
      {type === "redeem" || type === "investment_income" ? (
        <FormField id="qa-tax" label="Tax withheld" error={err("taxMinor")}>
          <Controller
            control={control}
            name="taxMinor"
            render={({ field }) => (
              <MoneyInput
                id="qa-tax"
                currency={currency}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FormField>
      ) : null}
      {type === "investment_income" ? (
        <>
          <FormField id="qa-income-kind" label="Kind">
            <Controller
              control={control}
              name="incomeKind"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v)}
                  items={INCOME_KINDS.map((k) => ({ ...k }))}
                >
                  <SelectTrigger id="qa-income-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INCOME_KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
            <Label htmlFor="qa-reinvest">
              Reinvested
              <span className="block text-xs font-normal text-muted-foreground">
                {reinvest ? "Adds to the holding; no cash moves." : "Paid out to an account."}
              </span>
            </Label>
            <Controller
              control={control}
              name="reinvest"
              render={({ field }) => (
                <Switch id="qa-reinvest" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Live redemption preview from the holding's current figures (the server recomputes on post). */
export function redeemPreview(
  holding: HoldingOption | undefined,
  byUnits: boolean,
  v: {
    amount: number | null;
    units: number | null;
    priceE4: number | null;
    fee: number | null;
    tax: number | null;
  },
): RedemptionResult | null {
  const num = (x: number | null | undefined) => (x && !Number.isNaN(x) ? x : 0);
  if (!holding || holding.currentValueMinor <= 0) return null;
  try {
    if (byUnits) {
      const price = num(v.priceE4) || holding.lastPriceMinorE4;
      if (!holding.units || !num(v.units) || !price) return null;
      return redeemByUnits({
        investedMinor: holding.investedMinor,
        currentValueMinor: holding.currentValueMinor,
        unitsHeld: holding.units,
        unitsSold: num(v.units),
        priceMinorE4: price,
        feeMinor: num(v.fee),
        taxMinor: num(v.tax),
      });
    }
    if (!num(v.amount)) return null;
    return redeemByAmount({
      investedMinor: holding.investedMinor,
      currentValueMinor: holding.currentValueMinor,
      amountMinor: num(v.amount),
      feeMinor: num(v.fee),
      taxMinor: num(v.tax),
    });
  } catch {
    return null;
  }
}
