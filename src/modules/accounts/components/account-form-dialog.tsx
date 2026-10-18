"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
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
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { ACCOUNT_TYPES, isLiability, type AccountType } from "@/domain/accounts";
import { isDateKey } from "@/domain/dates";
import { COMMON_CURRENCIES } from "@/lib/constants";
import { createAccountAction, updateAccountAction } from "@/modules/accounts/actions";
import { ACCOUNT_TYPE_META } from "@/modules/accounts/components/account-meta";
import type { AccountDTO } from "@/modules/accounts/schemas";

const day = z
  .number({ error: "Enter a day" })
  .int()
  .min(1, "Day 1–31")
  .max(31, "Day 1–31")
  .nullable();

const formSchema = z
  .object({
    type: z.enum(ACCOUNT_TYPES),
    name: z.string().trim().min(1, "Enter a name").max(60),
    currency: z.string().regex(/^[A-Z]{3}$/),
    institution: z.string().max(80),
    notes: z.string().max(500),
    /** Shown as entered: for liabilities this is the amount owed (positive). */
    openingAmountMinor: z.number({ error: "Enter an amount" }).int("Enter a valid amount"),
    openingDate: z.string().refine(isDateKey, "Pick a date"),
    includeInNetWorth: z.boolean(),
    countsTowardEmergencyFund: z.boolean(),
    limitMinor: z.number().int("Enter a valid amount").min(0).nullable(),
    statementDay: day,
    dueDay: day,
    counterparty: z.string().max(80),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "credit_card") return;
    if (v.limitMinor === null)
      ctx.addIssue({ code: "custom", path: ["limitMinor"], message: "Enter the limit" });
    if (v.statementDay === null)
      ctx.addIssue({ code: "custom", path: ["statementDay"], message: "Enter a day" });
    if (v.dueDay === null)
      ctx.addIssue({ code: "custom", path: ["dueDay"], message: "Enter a day" });
  });
type FormValues = z.infer<typeof formSchema>;

function defaults(
  account: AccountDTO | undefined,
  todayKey: string,
  baseCurrency: string,
): FormValues {
  if (!account) {
    return {
      type: "bank",
      name: "",
      currency: baseCurrency,
      institution: "",
      notes: "",
      openingAmountMinor: 0,
      openingDate: todayKey,
      includeInNetWorth: true,
      countsTowardEmergencyFund: false,
      limitMinor: null,
      statementDay: null,
      dueDay: null,
      counterparty: "",
    };
  }
  return {
    type: account.type,
    name: account.name,
    currency: account.currency,
    institution: account.institution ?? "",
    notes: account.notes ?? "",
    openingAmountMinor: isLiability(account.type)
      ? -account.openingBalanceMinor
      : account.openingBalanceMinor,
    openingDate: account.openingDate,
    includeInNetWorth: account.includeInNetWorth,
    countsTowardEmergencyFund: account.countsTowardEmergencyFund,
    limitMinor: account.creditCard?.limitMinor ?? null,
    statementDay: account.creditCard?.statementDay ?? null,
    dueDay: account.creditCard?.dueDay ?? null,
    counterparty: account.counterparty ?? "",
  };
}

/** Server field paths → form fields. */
const SERVER_FIELD: Record<string, Path<FormValues>> = {
  openingBalanceMinor: "openingAmountMinor",
  creditCard: "limitMinor",
  "creditCard.limitMinor": "limitMinor",
  "creditCard.statementDay": "statementDay",
  "creditCard.dueDay": "dueDay",
};

const numberOrNull = (v: string) => (v === "" ? null : Number(v));

export interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this account; omit to create. */
  account?: AccountDTO;
  todayKey: string;
  baseCurrency: string;
  onSaved?: (account: AccountDTO) => void;
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
  todayKey,
  baseCurrency,
  onSaved,
}: AccountFormDialogProps) {
  const router = useRouter();
  const editing = Boolean(account);
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults(account, todayKey, baseCurrency),
  });
  const type = useWatch({ control, name: "type" }) as AccountType;
  const currency = useWatch({ control, name: "currency" });
  const liability = isLiability(type);

  React.useEffect(() => {
    if (open) reset(defaults(account, todayKey, baseCurrency));
  }, [open, account, todayKey, baseCurrency, reset]);

  async function onSubmit(v: FormValues) {
    const payload = {
      name: v.name,
      currency: v.currency,
      institution: v.institution || null,
      notes: v.notes || null,
      openingBalanceMinor: liability ? -v.openingAmountMinor : v.openingAmountMinor,
      openingDate: v.openingDate,
      includeInNetWorth: v.includeInNetWorth,
      countsTowardEmergencyFund: v.countsTowardEmergencyFund,
      creditCard:
        v.type === "credit_card"
          ? {
              limitMinor: v.limitMinor ?? 0,
              statementDay: v.statementDay ?? 1,
              dueDay: v.dueDay ?? 1,
            }
          : null,
      counterparty: v.type === "receivable" || v.type === "payable" ? v.counterparty || null : null,
    };
    const result = account
      ? await updateAccountAction(account.id, payload)
      : await createAccountAction({ ...payload, type: v.type });
    if (!result.ok) {
      for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(SERVER_FIELD[key] ?? (key as Path<FormValues>), { message: messages[0] });
      }
      toast.error(result.error.message);
      return;
    }
    toast.success(account ? "Account updated" : `${result.data.name} added`);
    onOpenChange(false);
    onSaved?.(result.data);
    router.refresh();
  }

  const err = (k: keyof FormValues) => errors[k]?.message;
  const currencies = Array.from(new Set([currency, baseCurrency, ...COMMON_CURRENCIES]));
  const openingLabel = liability ? "Amount owed on opening date" : "Balance on opening date";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${account!.name}` : "Add account"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changes to the opening balance recalculate the account from its transactions."
              : "Start from today's balance, or an earlier date if you will enter older transactions."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="account-form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <FormField
              id="account-type"
              label="Type"
              error={err("type")}
              description={ACCOUNT_TYPE_META[type].hint}
            >
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                    disabled={editing}
                    items={ACCOUNT_TYPES.map((t) => ({
                      value: t,
                      label: ACCOUNT_TYPE_META[t].label,
                    }))}
                  >
                    <SelectTrigger
                      id="account-type"
                      className="w-full"
                      aria-describedby="account-type-description"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {ACCOUNT_TYPE_META[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>
          <FormField id="account-name" label="Name" error={err("name")}>
            <Input
              id="account-name"
              autoComplete="off"
              {...fieldAria("account-name", err("name"))}
              {...register("name")}
            />
          </FormField>
          <FormField id="account-currency" label="Currency" error={err("currency")}>
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                  <SelectTrigger id="account-currency" className="w-full">
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
          <FormField id="account-opening" label={openingLabel} error={err("openingAmountMinor")}>
            <Controller
              control={control}
              name="openingAmountMinor"
              render={({ field }) => (
                <MoneyInput
                  id="account-opening"
                  currency={currency}
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? 0)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  {...fieldAria("account-opening", err("openingAmountMinor"))}
                />
              )}
            />
          </FormField>
          <FormField id="account-opening-date" label="Opening date" error={err("openingDate")}>
            <Controller
              control={control}
              name="openingDate"
              render={({ field }) => (
                <DatePicker
                  id="account-opening-date"
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? "")}
                  aria-invalid={Boolean(err("openingDate"))}
                />
              )}
            />
          </FormField>

          {type === "credit_card" ? (
            <>
              <FormField id="card-limit" label="Credit limit" error={err("limitMinor")}>
                <Controller
                  control={control}
                  name="limitMinor"
                  render={({ field }) => (
                    <MoneyInput
                      id="card-limit"
                      currency={currency}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      {...fieldAria("card-limit", err("limitMinor"))}
                    />
                  )}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="card-statement" label="Statement day" error={err("statementDay")}>
                  <Input
                    id="card-statement"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    {...fieldAria("card-statement", err("statementDay"))}
                    {...register("statementDay", { setValueAs: numberOrNull })}
                  />
                </FormField>
                <FormField id="card-due" label="Due day" error={err("dueDay")}>
                  <Input
                    id="card-due"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    {...fieldAria("card-due", err("dueDay"))}
                    {...register("dueDay", { setValueAs: numberOrNull })}
                  />
                </FormField>
              </div>
            </>
          ) : null}

          {type === "receivable" || type === "payable" ? (
            <FormField
              id="account-counterparty"
              label={type === "receivable" ? "Who owes you" : "Who you owe"}
              error={err("counterparty")}
            >
              <Input id="account-counterparty" {...register("counterparty")} />
            </FormField>
          ) : (
            <FormField
              id="account-institution"
              label="Institution (optional)"
              error={err("institution")}
            >
              <Input id="account-institution" {...register("institution")} />
            </FormField>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
            <Label htmlFor="account-networth">Include in net worth</Label>
            <Controller
              control={control}
              name="includeInNetWorth"
              render={({ field }) => (
                <Switch
                  id="account-networth"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
          {!liability ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
              <Label htmlFor="account-emergency">Counts toward emergency fund</Label>
              <Controller
                control={control}
                name="countsTowardEmergencyFund"
                render={({ field }) => (
                  <Switch
                    id="account-emergency"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <FormField id="account-notes" label="Notes (optional)" error={err("notes")}>
              <Textarea id="account-notes" rows={2} {...register("notes")} />
            </FormField>
          </div>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" form="account-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : editing ? "Save changes" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
