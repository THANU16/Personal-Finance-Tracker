"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type Path } from "react-hook-form";
import { Plus, Split, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { minorUnitDigits } from "@/domain/money";
import { zodFieldErrors } from "@/server/action-result";
import { CategorySelect } from "@/modules/categories/components/category-select";
import {
  InvestmentFields,
  InvestmentHeader,
  redeemPreview,
  type QuickAddFormValues,
} from "@/modules/transactions/components/investment-fields";
import {
  createTransactionAction,
  getQuickAddOptionsAction,
  updateTransactionAction,
  type QuickAddOptions,
} from "@/modules/transactions/actions";
import type {
  QuickAddRequest,
  QuickAddType,
} from "@/modules/transactions/components/quick-add-context";
import { transactionInputSchema, type TransactionDTO } from "@/modules/transactions/schemas";
import {
  DipConfirmDialog,
  type DipConfirmation,
} from "@/modules/transactions/components/dip-confirm-dialog";
import type { ActionWarning } from "@/server/errors";

type FormValues = QuickAddFormValues;

const INVESTMENT_TYPES: QuickAddType[] = ["invest", "redeem", "investment_income"];

/** Transfer From/To values: an account id, or `h:<holdingId>` for an asset (owner request). */
const HOLDING_PREFIX = "h:";
const holdingRef = (value: string) =>
  value.startsWith(HOLDING_PREFIX) ? value.slice(HOLDING_PREFIX.length) : null;

const LAST_ACCOUNTS_KEY = "wt-quick-add-accounts";
type LastAccounts = Partial<
  Record<
    "expense" | "income" | "transferFrom" | "transferTo" | "invest" | "redeem" | "investmentIncome",
    string
  >
>;

function readLast(): LastAccounts {
  try {
    return JSON.parse(localStorage.getItem(LAST_ACCOUNTS_KEY) ?? "{}") as LastAccounts;
  } catch {
    return {};
  }
}

function rememberLast(v: FormValues) {
  try {
    const last = readLast();
    if (v.type === "expense") last.expense = v.fromAccountId;
    if (v.type === "income") last.income = v.toAccountId;
    if (v.type === "transfer") {
      last.transferFrom = v.fromAccountId;
      last.transferTo = v.toAccountId;
    }
    if (v.type === "invest") last.invest = v.fromAccountId;
    if (v.type === "redeem") last.redeem = v.toAccountId;
    if (v.type === "investment_income" && !v.reinvest) last.investmentIncome = v.toAccountId;
    localStorage.setItem(LAST_ACCOUNTS_KEY, JSON.stringify(last));
  } catch {
    // storage unavailable — remembering is a convenience only
  }
}

const EMPTY_SPLITS = [
  { categoryId: "", amountMinor: null },
  { categoryId: "", amountMinor: null },
];

function initialValues(request: QuickAddRequest, options: QuickAddOptions): FormValues {
  const ids = new Set(options.accounts.map((a) => a.id));
  const pick = (id: string | undefined, fallback = options.accounts[0]?.id ?? "") =>
    id && ids.has(id) ? id : fallback;
  const fromTxn = (t: TransactionDTO, date: string): FormValues => ({
    type: (["income", "transfer", ...INVESTMENT_TYPES] as string[]).includes(t.type)
      ? (t.type as QuickAddType)
      : "expense",
    date,
    amountMinor: t.amountMinor,
    fromAccountId: t.fromAccount?.id ?? "",
    toAccountId: t.toAccount?.id ?? "",
    toAmountMinor: t.toAmountMinor,
    categoryId: t.category?.id ?? "",
    splitMode: t.splits.length > 0,
    splits: t.splits.length
      ? t.splits.map((s) => ({ categoryId: s.category.id, amountMinor: s.amountMinor }))
      : EMPTY_SPLITS,
    description: t.description ?? "",
    counterparty: t.counterparty ?? "",
    tags: t.tags.join(", "),
    notes: t.notes ?? "",
    holdingId: t.holding?.id ?? "",
    feeMinor: t.feeMinor || null,
    taxMinor: t.taxMinor || null,
    units: t.units,
    priceMinorE4: t.priceMinorE4,
    redeemBy: t.type === "redeem" && t.units ? "units" : "amount",
    incomeKind: t.incomeKind ?? "dividend",
    reinvest: Boolean(t.reinvest),
  });
  if (request.mode === "edit") return fromTxn(request.txn, request.txn.date);
  if (request.duplicateOf) return fromTxn(request.duplicateOf, options.todayKey);

  const last = readLast();
  const type = request.type ?? "expense";
  const holdingIds = new Set(options.holdings.map((h) => h.id));
  const holdingId =
    request.holdingId && holdingIds.has(request.holdingId)
      ? request.holdingId
      : (options.holdings.find((h) => !h.isFd)?.id ?? "");
  const holding = options.holdings.find((h) => h.id === holdingId);
  /** A remembered account if it matches the holding's currency, else the first that does. */
  const forHolding = (remembered: string | undefined) => {
    const ok = (id: string | undefined) =>
      Boolean(id) &&
      options.accounts.some((a) => a.id === id && (!holding || a.currency === holding.currency));
    return ok(remembered)
      ? remembered!
      : (options.accounts.find((a) => !holding || a.currency === holding.currency)?.id ??
          pick(undefined));
  };
  const endpointIds = new Set([
    ...ids,
    ...options.holdings.filter((h) => !h.isFd).map((h) => `${HOLDING_PREFIX}${h.id}`),
  ]);
  const pickEndpoint = (id: string | undefined, fallback: string) =>
    id && endpointIds.has(id) ? id : fallback;
  const from =
    type === "transfer" && !request.accountId
      ? pickEndpoint(last.transferFrom, pick(undefined))
      : pick(request.accountId ?? (type === "transfer" ? last.transferFrom : last.expense));
  const toFallback = options.accounts.find((a) => a.id !== from)?.id ?? "";
  return {
    type,
    date: options.todayKey,
    amountMinor: request.amountMinor ?? null,
    fromAccountId: from,
    toAccountId:
      type === "income"
        ? pick(request.accountId ?? last.income)
        : type === "transfer"
          ? pickEndpoint(last.transferTo !== from ? last.transferTo : undefined, toFallback)
          : pick(last.transferTo !== from ? last.transferTo : undefined, toFallback),
    toAmountMinor: null,
    categoryId: "",
    splitMode: false,
    splits: EMPTY_SPLITS,
    description: "",
    counterparty: "",
    tags: "",
    notes: "",
    holdingId,
    feeMinor: null,
    taxMinor: null,
    units: null,
    priceMinorE4: null,
    redeemBy: "amount",
    incomeKind: "dividend",
    reinvest: false,
    ...(type === "invest" ? { fromAccountId: forHolding(request.accountId ?? last.invest) } : {}),
    ...(type === "redeem" ? { toAccountId: forHolding(request.accountId ?? last.redeem) } : {}),
    ...(type === "investment_income"
      ? { toAccountId: forHolding(request.accountId ?? last.investmentIncome) }
      : {}),
  };
}

/** Form values → the action input (the same Zod schema validates it on the server). */
function toInput(v: FormValues) {
  const base = {
    date: v.date,
    amountMinor: v.amountMinor ?? Number.NaN,
    description: v.description,
    counterparty: v.counterparty,
    notes: v.notes,
    tags: v.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
  if (v.type === "income")
    return { ...base, type: "income", toAccountId: v.toAccountId, categoryId: v.categoryId };
  if (v.type === "transfer") {
    const fromHolding = holdingRef(v.fromAccountId);
    const toHolding = holdingRef(v.toAccountId);
    return {
      ...base,
      type: "transfer",
      ...(fromHolding ? { fromHoldingId: fromHolding } : { fromAccountId: v.fromAccountId }),
      ...(toHolding ? { toHoldingId: toHolding } : { toAccountId: v.toAccountId }),
      toAmountMinor: fromHolding || toHolding ? null : v.toAmountMinor,
      feeMinor: v.feeMinor ?? 0,
    };
  }
  if (v.type === "invest") {
    return {
      ...base,
      type: "invest",
      fromAccountId: v.fromAccountId,
      holdingId: v.holdingId,
      feeMinor: v.feeMinor ?? 0,
      units: v.units,
      priceMinorE4: v.priceMinorE4,
    };
  }
  if (v.type === "redeem") {
    const byUnits = v.redeemBy === "units";
    return {
      ...base,
      type: "redeem",
      amountMinor: byUnits ? null : base.amountMinor,
      toAccountId: v.toAccountId,
      holdingId: v.holdingId,
      feeMinor: v.feeMinor ?? 0,
      taxMinor: v.taxMinor ?? 0,
      units: byUnits ? (v.units ?? Number.NaN) : null,
      priceMinorE4: byUnits ? v.priceMinorE4 : null,
    };
  }
  if (v.type === "investment_income") {
    return {
      ...base,
      type: "investment_income",
      holdingId: v.holdingId,
      incomeKind: v.incomeKind,
      taxMinor: v.taxMinor ?? 0,
      reinvest: v.reinvest,
      toAccountId: v.reinvest ? null : v.toAccountId,
    };
  }
  return v.splitMode
    ? {
        ...base,
        type: "expense",
        fromAccountId: v.fromAccountId,
        splits: v.splits.map((s) => ({
          categoryId: s.categoryId,
          amountMinor: s.amountMinor ?? Number.NaN,
        })),
      }
    : { ...base, type: "expense", fromAccountId: v.fromAccountId, categoryId: v.categoryId };
}

function AccountSelect({
  id,
  accounts,
  holdings,
  value,
  onChange,
  invalid,
}: {
  id: string;
  accounts: QuickAddOptions["accounts"];
  /** Transfer only: assets listed below the accounts (values `h:<id>`). */
  holdings?: QuickAddOptions["holdings"];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
}) {
  const accountItem = (a: QuickAddOptions["accounts"][number]) => (
    <SelectItem key={a.id} value={a.id}>
      <span className="flex w-full justify-between gap-4">
        <span>{a.name}</span>
        <Money
          valueMinor={a.balanceMinor}
          currency={a.currency}
          className="text-muted-foreground"
          colorNegative={false}
        />
      </span>
    </SelectItem>
  );
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(String(v ?? ""))}
      items={[
        ...accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
        ...(holdings ?? []).map((h) => ({
          value: `${HOLDING_PREFIX}${h.id}`,
          label: `${h.name} · asset · ${h.currency}`,
        })),
      ]}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder={holdings ? "Choose an account or asset" : "Choose an account"} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {holdings?.length ? (
          <>
            <SelectGroup>
              <SelectLabel>Accounts</SelectLabel>
              {accounts.map(accountItem)}
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Assets</SelectLabel>
              {holdings.map((h) => (
                <SelectItem key={h.id} value={`${HOLDING_PREFIX}${h.id}`}>
                  <span className="flex w-full justify-between gap-4">
                    <span>{h.name}</span>
                    <Money
                      valueMinor={h.currentValueMinor}
                      currency={h.currency}
                      className="text-muted-foreground"
                      colorNegative={false}
                    />
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : (
          accounts.map(accountItem)
        )}
      </SelectContent>
    </Select>
  );
}

function QuickAddForm({
  request,
  options,
  onDone,
}: {
  request: QuickAddRequest;
  options: QuickAddOptions;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = request.mode === "edit";
  const form = useForm<FormValues>({ defaultValues: initialValues(request, options) });
  const {
    control,
    register,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "splits" });
  const [type, fromId, toId, amount, splitMode, splits] = useWatch({
    control,
    name: ["type", "fromAccountId", "toAccountId", "amountMinor", "splitMode", "splits"],
  });

  const [holdingId, redeemBy, reinvest, units, priceE4, fee, tax] = useWatch({
    control,
    name: ["holdingId", "redeemBy", "reinvest", "units", "priceMinorE4", "feeMinor", "taxMinor"],
  });
  const account = (id: string) => options.accounts.find((a) => a.id === id);
  /** Transfer endpoint (account or asset) as name + currency. */
  const endpoint = (id: string): { name: string; currency: string } | undefined => {
    const h = holdingRef(id);
    return h ? options.holdings.find((x) => x.id === h) : account(id);
  };
  const from = endpoint(fromId);
  const to = endpoint(toId);
  const assetTransfer =
    type === "transfer" && (Boolean(holdingRef(fromId)) || Boolean(holdingRef(toId)));
  // FDs with deposit terms are withdrawn or renewed from their page, not transferred.
  const transferHoldings = options.holdings.filter((h) => !h.isFd);
  const investment = INVESTMENT_TYPES.includes(type);
  const holding = options.holdings.find((h) => h.id === holdingId);
  const holdingChoices = options.holdings.filter((h) => type === "investment_income" || !h.isFd);
  const currency = investment
    ? (holding?.currency ?? options.baseCurrency)
    : ((type === "income" ? to?.currency : from?.currency) ?? options.baseCurrency);
  const showFrom = type === "expense" || type === "transfer" || type === "invest";
  const showTo =
    type === "income" ||
    type === "transfer" ||
    type === "redeem" ||
    (type === "investment_income" && !reinvest);
  const byUnits = type === "redeem" && redeemBy === "units";
  const preview =
    type === "redeem"
      ? redeemPreview(holding, byUnits, { amount, units, priceE4, fee, tax })
      : null;
  const crossCurrency =
    type === "transfer" && !assetTransfer && from && to && from.currency !== to.currency;
  const splitTotal = splits.reduce(
    (s, l) => s + (l.amountMinor && !Number.isNaN(l.amountMinor) ? l.amountMinor : 0),
    0,
  );
  const remaining = (amount && !Number.isNaN(amount) ? amount : 0) - splitTotal;

  const toAmount = useWatch({ control, name: "toAmountMinor" });
  const rate =
    crossCurrency && amount && toAmount && !Number.isNaN(amount) && !Number.isNaN(toAmount)
      ? toAmount /
        10 ** minorUnitDigits(to!.currency) /
        (amount / 10 ** minorUnitDigits(from!.currency))
      : null;

  const err = (path: string): string | undefined => {
    let node: unknown = errors;
    for (const p of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[p];
    return (node as { message?: string } | undefined)?.message;
  };

  /**
   * Switching tabs keeps the account the user was working with in the field that matters for
   * the new type (e.g. Expense "Paid from" becomes Income "Received into"), unless a remembered
   * account for that type exists. Without this, income silently went to a different account.
   */
  function carryAccounts(next: QuickAddType) {
    const cur = getValues();
    const last = readLast();
    const valid = (id: string | undefined): id is string =>
      Boolean(id) && options.accounts.some((a) => a.id === id);
    const validEndpoint = (id: string | undefined): id is string =>
      valid(id) || Boolean(id && options.holdings.some((h) => `${HOLDING_PREFIX}${h.id}` === id));
    const picked = cur.type === "income" ? cur.toAccountId : cur.fromAccountId;
    const current = valid(picked) ? picked : (options.accounts[0]?.id ?? "");
    if (next === "income") setValue("toAccountId", valid(last.income) ? last.income : current);
    if (next === "expense") setValue("fromAccountId", valid(last.expense) ? last.expense : current);
    if (next === "invest") setValue("fromAccountId", valid(last.invest) ? last.invest : current);
    if (next === "redeem") setValue("toAccountId", valid(last.redeem) ? last.redeem : current);
    if (next === "investment_income") {
      setValue("toAccountId", valid(last.investmentIncome) ? last.investmentIncome : current);
    }
    if (next === "transfer") {
      const from = validEndpoint(last.transferFrom) ? last.transferFrom : current;
      const other = options.accounts.find((a) => a.id !== from)?.id ?? "";
      setValue("fromAccountId", from);
      setValue(
        "toAccountId",
        validEndpoint(last.transferTo) && last.transferTo !== from ? last.transferTo : other,
      );
    }
  }

  async function onSubmit(v: FormValues) {
    clearErrors();
    const input = toInput(v);
    const parsed = transactionInputSchema.safeParse(input);
    if (!parsed.success) {
      for (const [key, messages] of Object.entries(zodFieldErrors(parsed.error))) {
        setError((key === "_form" ? "root" : key) as Path<FormValues>, { message: messages[0] });
      }
      return;
    }
    await save(v, input);
  }

  // Dip guard (docs/04 §20): NEEDS_CONFIRMATION opens a dialog; confirming resubmits with the flags.
  const [confirm, setConfirm] = React.useState<{
    values: FormValues;
    input: ReturnType<typeof toInput>;
    warnings: ActionWarning[];
  } | null>(null);

  async function save(v: FormValues, input: ReturnType<typeof toInput>, flags?: DipConfirmation) {
    const payload = flags ? { ...input, ...flags } : input;
    const result =
      request.mode === "edit"
        ? await updateTransactionAction(request.txn.id, payload)
        : await createTransactionAction(payload);
    if (!result.ok) {
      if (result.error.code === "NEEDS_CONFIRMATION" && result.error.warnings?.length) {
        setConfirm({ values: v, input, warnings: result.error.warnings });
        return;
      }
      for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError((key === "_form" ? "root" : key) as Path<FormValues>, { message: messages[0] });
      }
      toast.error(result.error.message);
      return;
    }
    rememberLast(v);
    toast.success(
      editing ? "Transaction updated" : `${v.type[0]!.toUpperCase()}${v.type.slice(1)} saved`,
    );
    onDone();
    router.refresh();
  }

  if (options.accounts.length === 0) {
    return (
      <div className="px-4 text-sm text-muted-foreground">
        Add an account first.{" "}
        <Link
          href="/accounts"
          onClick={onDone}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Go to Accounts
        </Link>
      </div>
    );
  }

  return (
    <form
      id="quick-add-form"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid gap-4 overflow-y-auto px-4 pb-4">
        {!editing && options.templates.length ? (
          <FormField id="qa-template" label="From template (optional)">
            <Select
              value=""
              onValueChange={(v) => {
                const t = options.templates.find((x) => x.id === String(v));
                if (!t) return;
                // Fills the form only; the recurring rule itself is confirmed on /recurring.
                setValue("type", t.kind);
                setValue("amountMinor", t.amountMinor);
                if (t.fromAccountId) setValue("fromAccountId", t.fromAccountId);
                if (t.toAccountId) setValue("toAccountId", t.toAccountId);
                if (t.categoryId) setValue("categoryId", t.categoryId);
                setValue("splitMode", false);
                setValue("description", t.description ?? t.name);
                setValue("tags", t.tags.join(", "));
              }}
              items={options.templates.map((t) => ({ value: t.id, label: t.name }))}
            >
              <SelectTrigger id="qa-template" className="w-full">
                <SelectValue placeholder="Choose a recurring template" />
              </SelectTrigger>
              <SelectContent>
                {options.templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex w-full justify-between gap-4">
                      <span>{t.name}</span>
                      <span className="text-muted-foreground capitalize">{t.kind}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Tabs
              value={field.value}
              onValueChange={(v) => {
                if (!editing) carryAccounts(v as QuickAddType);
                field.onChange(v);
              }}
            >
              <TabsList className="grid w-full grid-cols-3 group-data-horizontal/tabs:h-auto">
                <TabsTrigger value="expense">Expense</TabsTrigger>
                <TabsTrigger value="income">Income</TabsTrigger>
                <TabsTrigger value="transfer">Transfer</TabsTrigger>
                <TabsTrigger value="invest">Invest</TabsTrigger>
                <TabsTrigger value="redeem">Redeem</TabsTrigger>
                <TabsTrigger value="investment_income">Inv. income</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        />

        {investment ? (
          <InvestmentHeader
            control={control}
            type={type}
            holdings={holdingChoices}
            holding={holding}
            err={err}
            onDone={onDone}
          />
        ) : null}

        {!byUnits ? (
          <FormField
            id="qa-amount"
            label={
              crossCurrency
                ? `Amount sent (${from!.currency})`
                : type === "invest"
                  ? "Amount invested"
                  : type === "redeem"
                    ? "Amount redeemed (gross)"
                    : type === "investment_income"
                      ? "Gross amount"
                      : "Amount"
            }
            error={err("amountMinor")}
          >
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <MoneyInput
                  id="qa-amount"
                  currency={currency}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  autoFocus
                  className="h-11 text-lg"
                  {...fieldAria("qa-amount", err("amountMinor"))}
                />
              )}
            />
          </FormField>
        ) : null}

        {investment ? (
          <InvestmentFields
            control={control}
            type={type}
            currency={currency}
            holding={holding}
            byUnits={byUnits}
            reinvest={reinvest}
            err={err}
          />
        ) : null}
        {preview ? (
          <div className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
            <span className="flex justify-between">
              Cost removed <Money valueMinor={preview.costRemovedMinor} currency={currency} />
            </span>
            <span className="flex justify-between">
              Realised gain{" "}
              <Money
                valueMinor={preview.realizedGainMinor}
                currency={currency}
                signed={preview.realizedGainMinor > 0}
              />
            </span>
            <span className="flex justify-between font-medium">
              Cash to account <Money valueMinor={preview.cashToAccountMinor} currency={currency} />
            </span>
            {preview.full ? (
              <span className="text-xs text-muted-foreground">Sells the whole holding.</span>
            ) : null}
          </div>
        ) : null}

        {showFrom ? (
          <FormField
            id="qa-from"
            label={type === "transfer" ? "From" : "Paid from"}
            error={err("fromAccountId")}
          >
            <Controller
              control={control}
              name="fromAccountId"
              render={({ field }) => (
                <AccountSelect
                  id="qa-from"
                  accounts={options.accounts}
                  holdings={type === "transfer" ? transferHoldings : undefined}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={Boolean(err("fromAccountId"))}
                />
              )}
            />
          </FormField>
        ) : null}
        {showTo ? (
          <FormField
            id="qa-to"
            label={type === "transfer" ? "To" : "Received into"}
            error={err("toAccountId")}
          >
            <Controller
              control={control}
              name="toAccountId"
              render={({ field }) => (
                <AccountSelect
                  id="qa-to"
                  accounts={options.accounts}
                  holdings={type === "transfer" ? transferHoldings : undefined}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={Boolean(err("toAccountId"))}
                />
              )}
            />
          </FormField>
        ) : null}

        {crossCurrency ? (
          <FormField
            id="qa-to-amount"
            label={`Amount received (${to!.currency})`}
            error={err("toAmountMinor")}
            description={
              rate
                ? `Rate 1 ${from!.currency} = ${rate.toPrecision(6)} ${to!.currency}`
                : "Different currencies: enter what arrived."
            }
          >
            <Controller
              control={control}
              name="toAmountMinor"
              render={({ field }) => (
                <MoneyInput
                  id="qa-to-amount"
                  currency={to!.currency}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  {...fieldAria("qa-to-amount", err("toAmountMinor"), true)}
                />
              )}
            />
          </FormField>
        ) : null}

        {type === "transfer" ? (
          <FormField
            id="qa-transfer-fee"
            label={`Fee (optional${from ? `, ${from.currency}` : ""})`}
            error={err("feeMinor")}
            description={
              assetTransfer
                ? "Charge (e.g. exit load) taken from the source on top of the amount; recorded as an investment fee."
                : "Bank charge taken from the source account on top of the amount; recorded under Bank fees."
            }
          >
            <Controller
              control={control}
              name="feeMinor"
              render={({ field }) => (
                <MoneyInput
                  id="qa-transfer-fee"
                  currency={from?.currency ?? currency}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  {...fieldAria("qa-transfer-fee", err("feeMinor"), true)}
                />
              )}
            />
          </FormField>
        ) : null}
        {assetTransfer && from && to ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {holdingRef(fromId) && holdingRef(toId)
              ? `Switch: sells from ${from.name} and buys ${to.name} (realised gain is recorded on ${from.name}).`
              : holdingRef(toId)
                ? `Recorded as an investment into ${to.name}.`
                : `Recorded as a redemption from ${from.name} (realised gain is calculated).`}
          </p>
        ) : null}
        {type === "transfer" &&
        fee &&
        !Number.isNaN(fee) &&
        amount &&
        !Number.isNaN(amount) &&
        from ? (
          <div
            className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
            aria-live="polite"
          >
            <span>Total leaving {from.name}</span>
            <Money valueMinor={amount + fee} currency={from.currency} />
          </div>
        ) : null}

        {(type === "income" || type === "expense") && !(type === "expense" && splitMode) ? (
          <FormField id="qa-category" label="Category" error={err("categoryId")}>
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <CategorySelect
                  id="qa-category"
                  tree={options.categories}
                  kind={type === "income" ? "income" : "expense"}
                  value={field.value}
                  onChange={field.onChange}
                  {...fieldAria("qa-category", err("categoryId"))}
                />
              )}
            />
          </FormField>
        ) : null}

        {type === "expense" ? (
          <div className="grid gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => setValue("splitMode", !splitMode)}
              aria-pressed={splitMode}
            >
              <Split aria-hidden /> {splitMode ? "Use one category" : "Split across categories"}
            </Button>
            {splitMode ? (
              <fieldset className="grid gap-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">Split</legend>
                {fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
                    <Controller
                      control={control}
                      name={`splits.${i}.categoryId`}
                      render={({ field }) => (
                        <CategorySelect
                          tree={options.categories}
                          kind="expense"
                          value={field.value}
                          onChange={field.onChange}
                          aria-invalid={Boolean(err(`splits.${i}.categoryId`))}
                        />
                      )}
                    />
                    <Controller
                      control={control}
                      name={`splits.${i}.amountMinor`}
                      render={({ field }) => (
                        <MoneyInput
                          aria-label={`Line ${i + 1} amount`}
                          currency={currency}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          aria-invalid={Boolean(err(`splits.${i}.amountMinor`))}
                        />
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={fields.length <= 2}
                      onClick={() => remove(i)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ categoryId: "", amountMinor: null })}
                    >
                      <Plus aria-hidden /> Line
                    </Button>
                    {remaining > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const lastIndex = fields.length - 1;
                          setValue(
                            `splits.${lastIndex}.amountMinor`,
                            (splits[lastIndex]?.amountMinor ?? 0) + remaining,
                          );
                        }}
                      >
                        Fill remaining
                      </Button>
                    ) : null}
                  </div>
                  <span
                    className={
                      !amount || remaining === 0 ? "text-muted-foreground" : "text-destructive"
                    }
                    aria-live="polite"
                  >
                    {!amount || Number.isNaN(amount) ? (
                      "Enter the total first"
                    ) : remaining === 0 ? (
                      "Fully split"
                    ) : (
                      <>
                        Remaining{" "}
                        <Money valueMinor={remaining} currency={currency} colorNegative={false} />
                      </>
                    )}
                  </span>
                </div>
                {err("splits") ? (
                  <p role="alert" className="text-xs text-destructive">
                    {err("splits")}
                  </p>
                ) : null}
              </fieldset>
            ) : null}
          </div>
        ) : null}

        <FormField id="qa-date" label="Date" error={err("date")}>
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <DatePicker
                id="qa-date"
                value={field.value}
                onChange={(v) => field.onChange(v ?? "")}
                aria-invalid={Boolean(err("date"))}
              />
            )}
          />
        </FormField>
        <FormField id="qa-description" label="Description" error={err("description")}>
          <Input id="qa-description" autoComplete="off" {...register("description")} />
        </FormField>
        {type === "income" || type === "expense" ? (
          <FormField
            id="qa-counterparty"
            label={type === "income" ? "Payer (optional)" : "Payee (optional)"}
            error={err("counterparty")}
          >
            <Input id="qa-counterparty" autoComplete="off" {...register("counterparty")} />
          </FormField>
        ) : null}
        <FormField
          id="qa-tags"
          label="Tags (optional)"
          error={err("tags")}
          description="Separate with commas."
        >
          <Input
            id="qa-tags"
            list="qa-tag-options"
            autoComplete="off"
            aria-describedby="qa-tags-description"
            {...register("tags")}
          />
          <datalist id="qa-tag-options">
            {options.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </FormField>
        <FormField id="qa-notes" label="Notes (optional)" error={err("notes")}>
          <Textarea id="qa-notes" rows={2} {...register("notes")} />
        </FormField>
        {errors.root ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        ) : null}
      </div>
      <SheetFooter className="border-t">
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Saving…" : editing ? "Save changes" : "Save"}
        </Button>
      </SheetFooter>
      <DipConfirmDialog
        warnings={confirm?.warnings ?? null}
        onCancel={() => setConfirm(null)}
        onConfirm={async (flags) => {
          if (!confirm) return;
          const pending = confirm;
          setConfirm(null);
          await save(pending.values, pending.input, flags);
        }}
      />
    </form>
  );
}

export function QuickAddSheet({
  open,
  request,
  onOpenChange,
}: {
  open: boolean;
  request: QuickAddRequest;
  onOpenChange: (open: boolean) => void;
}) {
  // Options are fetched per opening and tied to the request they were loaded for, so a reopened
  // sheet never shows the previous form with stale balances.
  const [loaded, setLoaded] = React.useState<{
    request: QuickAddRequest;
    options?: QuickAddOptions;
    error?: string;
    key: number;
  } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getQuickAddOptionsAction().then((result) => {
      if (cancelled) return;
      setLoaded((prev) => ({
        request,
        key: (prev?.key ?? 0) + 1,
        ...(result.ok ? { options: result.data } : { error: result.error.message }),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, request]);

  const current = loaded?.request === request ? loaded : null;
  const options = current?.options ?? null;
  const loadError = current?.error ?? null;
  const formKey = current?.key ?? 0;

  const title = request.mode === "edit" ? "Edit transaction" : "Quick add";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {request.mode === "edit"
              ? "Saving replaces the original (it is kept as void)."
              : "Record an expense, income or transfer. Press N anywhere to open this."}
          </SheetDescription>
        </SheetHeader>
        {loadError ? (
          <p role="alert" className="px-4 text-sm text-destructive">
            {loadError}
          </p>
        ) : options && formKey > 0 ? (
          <QuickAddForm
            key={formKey}
            request={request}
            options={options}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <div className="grid gap-4 px-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
