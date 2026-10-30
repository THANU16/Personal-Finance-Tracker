"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type Path } from "react-hook-form";
import { Landmark, Plus, Split, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { ActionSheet } from "@/components/shared/mobile/action-sheet";
import { ResponsiveSelect } from "@/components/shared/mobile/responsive-select";
import { useIsMobile } from "@/hooks/use-mobile";
import { minorUnitDigits } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
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

const RECENT_CATEGORIES_KEY = "wt-quick-add-categories";
const RECENT_MAX = 8;
type RecentCategories = Partial<Record<"expense" | "income", string[]>>;

function readRecentRaw(): string {
  try {
    return localStorage.getItem(RECENT_CATEGORIES_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function parseRecent(raw: string): RecentCategories {
  try {
    return JSON.parse(raw) as RecentCategories;
  } catch {
    return {};
  }
}

const readRecentCategories = () => parseRecent(readRecentRaw());
const noopSubscribe = () => () => {};

function rememberCategory(v: FormValues) {
  if ((v.type !== "expense" && v.type !== "income") || v.splitMode || !v.categoryId) return;
  try {
    const recent = readRecentCategories();
    const list = [v.categoryId, ...(recent[v.type] ?? []).filter((id) => id !== v.categoryId)];
    recent[v.type] = list.slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_CATEGORIES_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable — the grid is a convenience only
  }
}

/** Phones: the last used categories as one-tap chips above the full picker. */
function RecentCategoryGrid({
  tree,
  kind,
  value,
  onPick,
}: {
  tree: QuickAddOptions["categories"];
  kind: "expense" | "income";
  value: string;
  onPick: (id: string) => void;
}) {
  // localStorage is browser-only; the server snapshot is empty, so hydration agrees.
  const stored = React.useSyncExternalStore(
    noopSubscribe,
    () => readRecentRaw(),
    () => "{}",
  );
  const recent = (parseRecent(stored)[kind] ?? []) as string[];
  const names = new Map(
    tree
      .filter((c) => c.kind === kind)
      .flatMap((root) => [
        [root.id, root.name] as const,
        ...root.children.map((c) => [c.id, c.name] as const),
      ]),
  );
  const chips = recent.filter((id) => names.has(id));
  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label="Recent categories" className="grid grid-cols-2 gap-2 md:hidden">
      {chips.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onPick(id)}
          className={cn(
            "min-h-11 truncate rounded-lg border px-3 text-left text-sm",
            value === id
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-background active:bg-muted",
          )}
        >
          {names.get(id)}
        </button>
      ))}
    </div>
  );
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
    fromBucket: t.fromBucket ?? "",
    toBucket: t.toBucket ?? "",
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
    fromBucket: "",
    toBucket: "",
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
    return {
      ...base,
      type: "income",
      toAccountId: v.toAccountId,
      categoryId: v.categoryId,
      toBucket: v.toBucket || null,
    };
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
      fromBucket: v.fromBucket || null,
      toBucket: v.toBucket || null,
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
      fromBucket: v.fromBucket || null,
      toBucket: v.toBucket || null,
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
      fromBucket: v.fromBucket || null,
      toBucket: v.toBucket || null,
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
        fromBucket: v.fromBucket || null,
        splits: v.splits.map((s) => ({
          categoryId: s.categoryId,
          amountMinor: s.amountMinor ?? Number.NaN,
        })),
      }
    : {
        ...base,
        type: "expense",
        fromAccountId: v.fromAccountId,
        categoryId: v.categoryId,
        fromBucket: v.fromBucket || null,
      };
}

/** An account or holding that can carry earmarks (bucket choice in Quick add). */
type BucketSide = {
  name: string;
  currency: string;
  bucketable: boolean;
  emergencyMinor: number;
  opportunityMinor: number;
};

const BUCKET_CHOICES = [
  { value: "", label: "Normal" },
  { value: "emergency", label: "Emergency" },
  { value: "opportunity", label: "Opportunity" },
] as const;

/**
 * Optional bucket for one side of a transaction (owner request). Normal (default) = free cash, as
 * before; Emergency / Opportunity moves that account's earmark with the money.
 */
function BucketChoice({
  id,
  label,
  control,
  name,
  account,
  error,
  direction,
}: {
  id: string;
  label: string;
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: "fromBucket" | "toBucket";
  account: BucketSide;
  error?: string;
  direction: "in" | "out";
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="grid gap-1.5">
          <span id={id} className="text-sm font-medium">
            {label}
          </span>
          <div
            role="radiogroup"
            aria-labelledby={id}
            className="flex w-fit flex-wrap rounded-lg bg-muted p-0.5 text-sm"
          >
            {BUCKET_CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={field.value === c.value}
                onClick={() => field.onChange(c.value)}
                className={cn(
                  "rounded-md px-3 py-1 max-md:min-h-11",
                  field.value === c.value
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
            {error ??
              (field.value === ""
                ? direction === "out"
                  ? "From the free part (earmarks stay as they are)."
                  : "Arrives as free money."
                : direction === "out"
                  ? `Lowers the ${field.value} money on ${account.name} (now ${formatMoney(field.value === "emergency" ? account.emergencyMinor : account.opportunityMinor, account.currency)}).`
                  : `Adds to the ${field.value} money on ${account.name} (now ${formatMoney(field.value === "emergency" ? account.emergencyMinor : account.opportunityMinor, account.currency)}).`)}
          </p>
        </div>
      )}
    />
  );
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
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <ResponsiveSelect
        id={id}
        value={value || null}
        onValueChange={onChange}
        aria-invalid={invalid}
        placeholder={holdings ? "Choose an account or asset" : "Choose an account"}
        title={holdings ? "Account or asset" : "Account"}
        options={[
          ...accounts.map((a) => ({
            value: a.id,
            label: a.name,
            description: formatMoney(a.balanceMinor, a.currency),
            group: holdings?.length ? "Accounts" : undefined,
          })),
          ...(holdings ?? []).map((h) => ({
            value: `${HOLDING_PREFIX}${h.id}`,
            label: h.name,
            description: formatMoney(h.currentValueMinor, h.currency),
            group: "Assets",
          })),
        ]}
      />
    );
  }
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
  const isMobile = useIsMobile();
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
    reset,
    setFocus,
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
  // Optional bucket choice (owner request): each side is an account or a holding that can hold
  // earmarks. A buy puts into the holding's bucket; a sale takes from it.
  const holdingSide = (id: string | null) =>
    id ? options.holdings.find((x) => x.id === id) : undefined;
  const endpointSide = (id: string) => (holdingRef(id) ? holdingSide(holdingRef(id)) : account(id));
  const fromSide: BucketSide | undefined =
    type === "redeem"
      ? holdingSide(holdingId)
      : type === "expense" || type === "transfer" || type === "invest"
        ? endpointSide(fromId)
        : undefined;
  const toSide: BucketSide | undefined =
    type === "invest"
      ? holdingSide(holdingId)
      : type === "income" || type === "transfer" || type === "redeem"
        ? endpointSide(toId)
        : undefined;
  const showFromBucket = Boolean(fromSide?.bucketable);
  const showToBucket = Boolean(toSide?.bucketable);
  // A hidden choice goes back to Normal, so a stale bucket is never sent for another account/type.
  React.useEffect(() => {
    if (!showFromBucket && getValues("fromBucket")) setValue("fromBucket", "");
    if (!showToBucket && getValues("toBucket")) setValue("toBucket", "");
  }, [showFromBucket, showToBucket, getValues, setValue]);
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

  async function onSubmit(v: FormValues, e?: React.BaseSyntheticEvent) {
    // "Save & add another" (phones) is a second submit button: keep type, accounts and date.
    const submitter = (e?.nativeEvent as SubmitEvent | undefined)?.submitter;
    const again = submitter instanceof HTMLElement && submitter.dataset.addAnother === "1";
    clearErrors();
    const input = toInput(v);
    const parsed = transactionInputSchema.safeParse(input);
    if (!parsed.success) {
      for (const [key, messages] of Object.entries(zodFieldErrors(parsed.error))) {
        setError((key === "_form" ? "root" : key) as Path<FormValues>, { message: messages[0] });
      }
      return;
    }
    await save(v, input, undefined, again);
  }

  // Dip guard (docs/04 §20): NEEDS_CONFIRMATION opens a dialog; confirming resubmits with the flags.
  const [confirm, setConfirm] = React.useState<{
    values: FormValues;
    input: ReturnType<typeof toInput>;
    warnings: ActionWarning[];
    again: boolean;
  } | null>(null);

  async function save(
    v: FormValues,
    input: ReturnType<typeof toInput>,
    flags?: DipConfirmation,
    again = false,
  ) {
    const payload = flags ? { ...input, ...flags } : input;
    const result =
      request.mode === "edit"
        ? await updateTransactionAction(request.txn.id, payload)
        : await createTransactionAction(payload);
    if (!result.ok) {
      if (result.error.code === "NEEDS_CONFIRMATION" && result.error.warnings?.length) {
        setConfirm({ values: v, input, warnings: result.error.warnings, again });
        return;
      }
      for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError((key === "_form" ? "root" : key) as Path<FormValues>, { message: messages[0] });
      }
      toast.error(result.error.message);
      return;
    }
    rememberLast(v);
    rememberCategory(v);
    toast.success(
      editing ? "Transaction updated" : `${v.type[0]!.toUpperCase()}${v.type.slice(1)} saved`,
    );
    router.refresh();
    if (again && !editing) {
      reset({
        ...getValues(),
        amountMinor: null,
        toAmountMinor: null,
        categoryId: "",
        splitMode: false,
        splits: EMPTY_SPLITS,
        description: "",
        counterparty: "",
        tags: "",
        notes: "",
      });
      setFocus("amountMinor");
      return;
    }
    onDone();
  }

  const loans = options.accounts.filter((a) => a.type === "loan");
  const templateField = (id: string) => (
    <FormField id={id} label="From template (optional)">
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
        <SelectTrigger id={id} className="w-full">
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
  );

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
        {/* Templates: first on desktop; phones put them last (amount first, docs/07 §5). */}
        {!editing && options.templates.length ? (
          <div className="hidden md:contents">{templateField("qa-template")}</div>
        ) : null}
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            // Phones: one row of type chips that scrolls sideways, with "Debt pay" at the end.
            // The grid item is a plain block: its height follows the content (a scroll container
            // as grid item collapses) and min-w-0 keeps the wide row from widening the form.
            <div className="-mx-4 min-w-0 md:mx-0">
              <div className="flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 md:block md:overflow-visible md:px-0">
                <Tabs
                  value={field.value}
                  onValueChange={(v) => {
                    if (!editing) carryAccounts(v as QuickAddType);
                    field.onChange(v);
                  }}
                >
                  <TabsList className="flex w-max group-data-horizontal/tabs:h-auto md:grid md:w-full md:grid-cols-3 md:group-data-horizontal/tabs:h-auto">
                    {(
                      [
                        ["expense", "Expense"],
                        ["income", "Income"],
                        ["transfer", "Transfer"],
                        ["invest", "Invest"],
                        ["redeem", "Redeem"],
                        ["investment_income", "Inv. income"],
                      ] as const
                    ).map(([value, label]) => (
                      <TabsTrigger key={value} value={value} className="shrink-0 px-3 md:px-1.5">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {!editing && isMobile && loans.length ? (
                  <ActionSheet
                    title="Pay a loan"
                    description="Opens the loan with Record payment ready."
                    trigger={
                      <Button type="button" variant="outline" className="shrink-0 rounded-lg">
                        <Landmark aria-hidden /> Debt pay
                      </Button>
                    }
                    actions={loans.map((l) => ({
                      label: l.name,
                      icon: Landmark,
                      onSelect: () => {
                        onDone();
                        router.push(`/debts/by-account/${l.id}`);
                      },
                    }))}
                  />
                ) : null}
              </div>
            </div>
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
                  size={isMobile ? "lg" : "default"}
                  className={isMobile ? undefined : "h-11 text-lg md:h-11"}
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
        {type === "invest" && showToBucket ? (
          <BucketChoice
            id="qa-holding-to-bucket"
            label="Put into (optional)"
            control={control}
            name="toBucket"
            account={toSide!}
            error={err("toBucket")}
            direction="in"
          />
        ) : null}
        {type === "redeem" && showFromBucket ? (
          <BucketChoice
            id="qa-holding-from-bucket"
            label="Sell from (optional)"
            control={control}
            name="fromBucket"
            account={fromSide!}
            error={err("fromBucket")}
            direction="out"
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
        {showFromBucket && type !== "redeem" ? (
          <BucketChoice
            id="qa-from-bucket"
            label={type === "transfer" ? "Take from (optional)" : "Pay from (optional)"}
            control={control}
            name="fromBucket"
            account={fromSide!}
            error={err("fromBucket")}
            direction="out"
          />
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
        {showToBucket && type !== "invest" ? (
          <BucketChoice
            id="qa-to-bucket"
            label="Put into (optional)"
            control={control}
            name="toBucket"
            account={toSide!}
            error={err("toBucket")}
            direction="in"
          />
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
                <>
                  <RecentCategoryGrid
                    tree={options.categories}
                    kind={type === "income" ? "income" : "expense"}
                    value={field.value}
                    onPick={field.onChange}
                  />
                  <CategorySelect
                    id="qa-category"
                    tree={options.categories}
                    kind={type === "income" ? "income" : "expense"}
                    value={field.value}
                    onChange={field.onChange}
                    {...fieldAria("qa-category", err("categoryId"))}
                  />
                </>
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
        {!editing && options.templates.length ? (
          <div className="md:hidden">{templateField("qa-template-mobile")}</div>
        ) : null}
        {errors.root ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        ) : null}
      </div>
      <SheetFooter className="border-t pb-[calc(1rem+env(safe-area-inset-bottom)+var(--drawer-keyboard-inset,0px))] md:pb-4">
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Saving…" : editing ? "Save changes" : "Save"}
        </Button>
        {!editing ? (
          <Button
            type="submit"
            variant="outline"
            disabled={isSubmitting}
            className="w-full md:hidden"
            data-add-another="1"
          >
            Save &amp; add another
          </Button>
        ) : null}
      </SheetFooter>
      <DipConfirmDialog
        warnings={confirm?.warnings ?? null}
        onCancel={() => setConfirm(null)}
        onConfirm={async (flags) => {
          if (!confirm) return;
          const pending = confirm;
          setConfirm(null);
          await save(pending.values, pending.input, flags, pending.again);
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
  const isMobile = useIsMobile();

  const body = (
    <>
      <SheetHeader className="pt-2 md:pt-4">
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
    </>
  );

  // Phones (docs/07 §5): a full-height bottom sheet (swipe down to close); desktop: side sheet.
  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent mobileLayout="fill" showCloseButton={false}>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {body}
      </SheetContent>
    </Sheet>
  );
}
