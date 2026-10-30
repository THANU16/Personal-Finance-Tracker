"use client";

import { Controller, useForm, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
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
import { FormField, fieldAria } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { COMMON_CURRENCIES, LOCALES } from "@/lib/constants";
import { updateSettingsAction } from "@/modules/settings/actions";
import { updateSettingsSchema, type SettingsDTO } from "@/modules/settings/schemas";
import { PinnedOnPhone } from "@/components/shared/mobile/pinned-on-phone";

const formSchema = updateSettingsSchema
  .required()
  .refine((v) => v.emergencyExpenseBasis !== "manual" || v.emergencyManualMonthlyMinor !== null, {
    path: ["emergencyManualMonthlyMinor"],
    message: "Enter a monthly amount",
  });
type FormValues = z.infer<typeof formSchema>;

function toFormValues(s: SettingsDTO): FormValues {
  return {
    baseCurrency: s.baseCurrency,
    timezone: s.timezone,
    locale: s.locale,
    staleDays: s.staleDays,
    bigChangeThresholdBp: s.bigChangeThresholdBp,
    driftThresholdBp: s.driftThresholdBp,
    emergencyMonths: s.emergencyMonths,
    emergencyExpenseBasis: s.emergencyExpenseBasis,
    emergencyManualMonthlyMinor: s.emergencyManualMonthlyMinor,
    emergencyTargetOverrideMinor: s.emergencyTargetOverrideMinor,
    lifeCoverIncomeMultiple: s.lifeCoverIncomeMultiple,
    healthCoverTargetMinor: s.healthCoverTargetMinor,
    minBalanceWarningMinor: s.minBalanceWarningMinor,
    projectionReturnBp: s.projectionReturnBp,
    notify: { ...s.notify },
  };
}

const BASES = [
  {
    value: "essential",
    label: "Essential expenses",
    hint: "Spending in categories flagged essential. Uses all expenses if none are flagged.",
  },
  { value: "all", label: "All expenses", hint: "Everything you spent." },
  { value: "manual", label: "A fixed monthly amount", hint: "Enter the amount below." },
] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid items-start gap-5 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export function PreferencesForm({
  settings,
  timezones,
}: {
  settings: SettingsDTO;
  timezones: string[];
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(settings),
  });
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;
  const currency = useWatch({ control, name: "baseCurrency" });
  const basis = useWatch({ control, name: "emergencyExpenseBasis" });
  const currencies = Array.from(new Set([settings.baseCurrency, ...COMMON_CURRENCIES]));
  const zones = timezones.includes(settings.timezone)
    ? timezones
    : [settings.timezone, ...timezones];

  async function onSubmit(values: FormValues) {
    const result = await updateSettingsAction(values);
    if (!result.ok) {
      for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(key as Path<FormValues>, { message: messages[0] });
      }
      toast.error(result.error.message);
      return;
    }
    reset(toFormValues(result.data));
    toast.success("Preferences saved");
  }

  const err = (path: string) => {
    const parts = path.split(".");
    let node: unknown = errors;
    for (const p of parts) node = (node as Record<string, unknown> | undefined)?.[p];
    return (node as { message?: string } | undefined)?.message;
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6">
      <Section title="Currency & region" description="Reports convert to the base currency.">
        <FormField id="baseCurrency" label="Base currency" error={err("baseCurrency")}>
          <Controller
            control={control}
            name="baseCurrency"
            render={({ field }) => (
              <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                <SelectTrigger
                  id="baseCurrency"
                  className="w-full"
                  {...fieldAria("baseCurrency", err("baseCurrency"))}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField
          id="timezone"
          label="Timezone"
          error={err("timezone")}
          description="Months, weeks and due dates use this timezone."
        >
          <Controller
            control={control}
            name="timezone"
            render={({ field }) => (
              <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                <SelectTrigger
                  id="timezone"
                  className="w-full"
                  {...fieldAria("timezone", err("timezone"), true)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField id="locale" label="Number format" error={err("locale")}>
          <Controller
            control={control}
            name="locale"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => field.onChange(v)}
                items={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
              >
                <SelectTrigger
                  id="locale"
                  className="w-full"
                  {...fieldAria("locale", err("locale"))}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </Section>

      <Section
        title="Alerts & thresholds"
        description="When values count as stale and changes as big."
      >
        <FormField
          id="staleDays"
          label="Stale after (days)"
          error={err("staleDays")}
          description="Holdings not valued for this long get a Stale badge."
        >
          <Input
            id="staleDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            {...fieldAria("staleDays", err("staleDays"), true)}
            {...register("staleDays", { valueAsNumber: true })}
          />
        </FormField>
        <FormField
          id="bigChangeThresholdBp"
          label="Big valuation change"
          error={err("bigChangeThresholdBp")}
          description="Ask to confirm value updates that move more than this."
        >
          <Controller
            control={control}
            name="bigChangeThresholdBp"
            render={({ field }) => (
              <PercentInput
                id="bigChangeThresholdBp"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                {...fieldAria("bigChangeThresholdBp", err("bigChangeThresholdBp"), true)}
              />
            )}
          />
        </FormField>
        <FormField
          id="driftThresholdBp"
          label="Rebalancing drift alert"
          error={err("driftThresholdBp")}
          description="Flag an asset class this far from its target."
        >
          <Controller
            control={control}
            name="driftThresholdBp"
            render={({ field }) => (
              <PercentInput
                id="driftThresholdBp"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                {...fieldAria("driftThresholdBp", err("driftThresholdBp"), true)}
              />
            )}
          />
        </FormField>
        <FormField
          id="minBalanceWarningMinor"
          label="Low balance warning"
          error={err("minBalanceWarningMinor")}
          description="Forecast warns when an account would drop below this."
        >
          <Controller
            control={control}
            name="minBalanceWarningMinor"
            render={({ field }) => (
              <MoneyInput
                id="minBalanceWarningMinor"
                currency={currency}
                value={field.value}
                onChange={(v) => field.onChange(v ?? 0)}
                onBlur={field.onBlur}
                ref={field.ref}
                {...fieldAria("minBalanceWarningMinor", err("minBalanceWarningMinor"), true)}
              />
            )}
          />
        </FormField>
        <FormField
          id="projectionReturnBp"
          label="Projection return (yearly)"
          error={err("projectionReturnBp")}
          description="Net worth projection on Forecast uses this ± 2 points. An estimate only."
        >
          <Controller
            control={control}
            name="projectionReturnBp"
            render={({ field }) => (
              <PercentInput
                id="projectionReturnBp"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                {...fieldAria("projectionReturnBp", err("projectionReturnBp"), true)}
              />
            )}
          />
        </FormField>
      </Section>

      <Section
        title="Emergency fund"
        description="Target = fixed target if set, otherwise monthly basis × months. Essential and all-expense bases use your average monthly spending over the last 6 complete months."
      >
        <FormField id="emergencyMonths" label="Months of expenses" error={err("emergencyMonths")}>
          <Input
            id="emergencyMonths"
            type="number"
            inputMode="numeric"
            min={1}
            max={24}
            {...fieldAria("emergencyMonths", err("emergencyMonths"))}
            {...register("emergencyMonths", { valueAsNumber: true })}
          />
        </FormField>
        <div className="grid gap-2 sm:col-span-2">
          <Label id="emergencyExpenseBasis-label">Monthly basis</Label>
          <Controller
            control={control}
            name="emergencyExpenseBasis"
            render={({ field }) => (
              <RadioGroup
                aria-labelledby="emergencyExpenseBasis-label"
                value={field.value}
                onValueChange={(v) => field.onChange(v)}
                className="gap-3"
              >
                {BASES.map((b) => (
                  <Label
                    key={b.value}
                    className="flex items-start gap-3 rounded-lg border p-3 font-normal"
                  >
                    <RadioGroupItem value={b.value} className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{b.label}</span>
                      <span className="text-xs text-muted-foreground">{b.hint}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            )}
          />
        </div>
        {basis === "manual" ? (
          <FormField
            id="emergencyManualMonthlyMinor"
            label="Monthly amount"
            error={err("emergencyManualMonthlyMinor")}
          >
            <Controller
              control={control}
              name="emergencyManualMonthlyMinor"
              render={({ field }) => (
                <MoneyInput
                  id="emergencyManualMonthlyMinor"
                  currency={currency}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  {...fieldAria("emergencyManualMonthlyMinor", err("emergencyManualMonthlyMinor"))}
                />
              )}
            />
          </FormField>
        ) : null}
        <FormField
          id="emergencyTargetOverrideMinor"
          label="Fixed target (optional)"
          error={err("emergencyTargetOverrideMinor")}
          description="Replaces the calculated target. Leave empty to calculate it."
        >
          <Controller
            control={control}
            name="emergencyTargetOverrideMinor"
            render={({ field }) => (
              <MoneyInput
                id="emergencyTargetOverrideMinor"
                currency={currency}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                {...fieldAria(
                  "emergencyTargetOverrideMinor",
                  err("emergencyTargetOverrideMinor"),
                  true,
                )}
              />
            )}
          />
        </FormField>
      </Section>

      <Section title="Insurance" description="Targets used by Essentials and the health score.">
        <FormField
          id="lifeCoverIncomeMultiple"
          label="Life cover (× annual income)"
          error={err("lifeCoverIncomeMultiple")}
        >
          <Input
            id="lifeCoverIncomeMultiple"
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            {...fieldAria("lifeCoverIncomeMultiple", err("lifeCoverIncomeMultiple"))}
            {...register("lifeCoverIncomeMultiple", { valueAsNumber: true })}
          />
        </FormField>
        <FormField
          id="healthCoverTargetMinor"
          label="Health cover target"
          error={err("healthCoverTargetMinor")}
          description="Leave empty if you have not set one."
        >
          <Controller
            control={control}
            name="healthCoverTargetMinor"
            render={({ field }) => (
              <MoneyInput
                id="healthCoverTargetMinor"
                currency={currency}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                {...fieldAria("healthCoverTargetMinor", err("healthCoverTargetMinor"), true)}
              />
            )}
          />
        </FormField>
      </Section>

      <Section
        title="Notifications"
        description="Reminders for SIPs, bills, maturities and stale values."
      >
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <Label htmlFor="notifyInApp">In-app notifications</Label>
          <Controller
            control={control}
            name="notify.inApp"
            render={({ field }) => (
              <Switch id="notifyInApp" checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <Label htmlFor="notifyEmail">Email reminders</Label>
          <Controller
            control={control}
            name="notify.email"
            render={({ field }) => (
              <Switch id="notifyEmail" checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
        </div>
        <FormField
          id="dailyHourLocal"
          label="Daily reminder time"
          error={err("notify.dailyHourLocal")}
        >
          <Controller
            control={control}
            name="notify.dailyHourLocal"
            render={({ field }) => (
              <Select
                value={String(field.value)}
                onValueChange={(v) => field.onChange(Number(v))}
                items={HOURS}
              >
                <SelectTrigger id="dailyHourLocal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {HOURS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </Section>

      <PinnedOnPhone className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!isDirty || isSubmitting}
          onClick={() => reset()}
        >
          Discard changes
        </Button>
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? "Saving…" : "Save preferences"}
        </Button>
      </PinnedOnPhone>
    </form>
  );
}
