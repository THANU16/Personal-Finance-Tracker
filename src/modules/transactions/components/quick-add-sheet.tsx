"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type Path } from "react-hook-form";
import { ArrowDownUp, ChevronDown, Landmark, Plus, Split, Trash2 } from "lucide-react";
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
  applyKeypadKey,
  evaluateAmountExpression,
  isCalculation,
  minorToKeypad,
} from "@/domain/amount-expression";
import {
  AccountPanel,
  type AccountTileItem,
  tileMoney,
} from "@/modules/transactions/components/phone-entry/account-panel";
import {
  CalendarPanel,
  addDaysKey,
  formatDateKey,
} from "@/modules/transactions/components/phone-entry/calendar-panel";
import {
  CategoryPanel,
  categoryPath,
} from "@/modules/transactions/components/phone-entry/category-panel";
import { KeypadPanel } from "@/modules/transactions/components/phone-entry/keypad-panel";
import { rememberCategoryId } from "@/modules/transactions/components/phone-entry/recent-categories";
import {
  RowSideButton,
  TapRow,
  type RowTone,
} from "@/modules/transactions/components/phone-entry/tap-row";
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

function rememberCategory(v: FormValues) {
  if ((v.type !== "expense" && v.type !== "income") || v.splitMode || !v.categoryId) return;
  rememberCategoryId(v.type, v.categoryId);
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
  const [date, categoryId, tagsValue, notesValue, counterpartyValue] = useWatch({
    control,
    name: ["date", "categoryId", "tags", "notes", "counterparty"],
  });
  const [fromBucket, toBucket] = useWatch({ control, name: ["fromBucket", "toBucket"] });
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

  // ---- Phones (owner request, 2026-11-09; docs/07 §5): tap rows + one bottom panel ----------
  // Amount uses a calculator keypad, date a calendar, category / account / asset tiles; each pick
  // opens the next empty field. A new form opens on the keypad. Desktop is unchanged.
  type Panel = "date" | "amount" | "fee" | "category" | "from" | "to" | "holding";
  const [panel, setPanel] = React.useState<Panel | null>(isMobile && !editing ? "amount" : null);
  const amountDigits = minorUnitDigits(currency);
  const feeCurrency = from?.currency ?? currency;
  const feeDigits = minorUnitDigits(feeCurrency);
  const [expr, setExpr] = React.useState(() =>
    minorToKeypad(getValues("amountMinor"), amountDigits),
  );
  const [feeOpen, setFeeOpen] = React.useState(() => Boolean(getValues("feeMinor")));
  const [moreOpen, setMoreOpen] = React.useState(false);
  // A pre-filled asset is only a guess unless it came with the request or an existing entry.
  const [holdingChosen, setHoldingChosen] = React.useState(
    request.mode === "edit" || Boolean(request.holdingId || request.duplicateOf),
  );
  const tone: RowTone =
    type === "income" || type === "investment_income"
      ? "income"
      : type === "expense"
        ? "expense"
        : "neutral";

  /** Writes the keypad text into the field; false (with a field error) when it is not valid. */
  function commitKeypad(target: "amountMinor" | "feeMinor", text: string): boolean {
    if (text.trim() === "") {
      setValue(target, null);
      return target === "feeMinor";
    }
    const value = evaluateAmountExpression(text, target === "feeMinor" ? feeDigits : amountDigits);
    const bad =
      value === null
        ? "Check the sum"
        : target === "amountMinor" && value <= 0
          ? "Enter an amount more than 0"
          : value < 0
            ? "A fee cannot be below 0"
            : null;
    if (bad) {
      setError(target, { message: bad });
      return false;
    }
    setValue(target, value, { shouldDirty: true });
    clearErrors(target);
    return true;
  }

  function openPanel(next: Panel | null) {
    if (panel === "amount" || panel === "fee") {
      commitKeypad(panel === "fee" ? "feeMinor" : "amountMinor", expr);
    }
    if (next === "amount") setExpr(minorToKeypad(getValues("amountMinor"), amountDigits));
    if (next === "fee") setExpr(minorToKeypad(getValues("feeMinor"), feeDigits));
    setPanel(next);
  }

  const flow: Panel[] =
    type === "expense"
      ? splitMode
        ? ["amount", "from"]
        : ["amount", "category", "from"]
      : type === "income"
        ? ["amount", "category", "to"]
        : type === "transfer"
          ? ["amount", "from", "to"]
          : type === "invest"
            ? ["amount", "holding", "from"]
            : type === "redeem"
              ? byUnits
                ? ["holding", "to"]
                : ["amount", "holding", "to"]
              : reinvest
                ? ["amount", "holding"]
                : ["amount", "holding", "to"];

  /** After a pick: the next field in the flow that is still empty, else the Note field. */
  function advance(after: Panel, holdingPicked = holdingChosen) {
    const filled = (p: Panel) =>
      p === "amount"
        ? Boolean(getValues("amountMinor"))
        : p === "category"
          ? Boolean(getValues("categoryId"))
          : p === "from"
            ? Boolean(getValues("fromAccountId"))
            : p === "to"
              ? Boolean(getValues("toAccountId"))
              : p === "holding"
                ? holdingPicked && Boolean(getValues("holdingId"))
                : true;
    const next = flow.slice(flow.indexOf(after) + 1).find((p) => !filled(p));
    if (next) {
      if (next === "amount") setExpr(minorToKeypad(getValues("amountMinor"), amountDigits));
      setPanel(next);
      return;
    }
    setPanel(null);
    requestAnimationFrame(() => document.getElementById("qa-description")?.focus());
  }

  function keypadOk() {
    const target = panel === "fee" ? "feeMinor" : "amountMinor";
    if (target === "amountMinor" && expr.trim() === "") {
      setError("amountMinor", { message: "Enter an amount" });
      return;
    }
    if (!commitKeypad(target, expr)) return;
    if (target === "feeMinor") setPanel(null);
    else advance("amount");
  }

  function keypadEquals() {
    const digits = panel === "fee" ? feeDigits : amountDigits;
    const value = evaluateAmountExpression(expr, digits);
    if (value === null) return;
    if (value < 0) {
      setError(panel === "fee" ? "feeMinor" : "amountMinor", { message: "The result is below 0" });
      return;
    }
    setExpr(minorToKeypad(value, digits));
  }

  function toggleFees() {
    if (feeOpen) {
      setFeeOpen(false);
      setValue("feeMinor", null);
      clearErrors("feeMinor");
      if (panel === "fee") setPanel(null);
      return;
    }
    setFeeOpen(true);
    openPanel("fee");
  }

  /** A type switch closes a picker that belongs to the old type. */
  function closeStalePanel() {
    if (panel && panel !== "amount" && panel !== "date") setPanel(null);
  }

  // Keep the open row in view above the panel.
  React.useEffect(() => {
    if (!panel) return;
    const id = panel === "fee" ? "qa-transfer-fee" : `qa-${panel}`;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, [panel]);

  const accountTile = (a: QuickAddOptions["accounts"][number]): AccountTileItem => {
    const setAside = a.bucketable ? a.emergencyMinor + a.opportunityMinor : 0;
    return {
      value: a.id,
      name: a.name,
      balanceMinor: a.balanceMinor,
      currency: a.currency,
      freeMinor: setAside > 0 ? Math.max(0, a.balanceMinor - setAside) : null,
      note: a.type === "opportunity_fund" ? "Opportunity money" : undefined,
    };
  };
  const holdingTile = (
    h: QuickAddOptions["holdings"][number],
    prefix: string,
  ): AccountTileItem => ({
    value: `${prefix}${h.id}`,
    name: h.name,
    balanceMinor: h.currentValueMinor,
    currency: h.currency,
    freeMinor: null,
  });

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
      if (isMobile) {
        setExpr("");
        setPanel("amount");
      } else setFocus("amountMinor");
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

  const typeTabs = (
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
                closeStalePanel();
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
  );
  const previewBlock = preview ? (
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
  ) : null;
  const toAmountField = crossCurrency ? (
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
  ) : null;
  const assetTransferHint =
    assetTransfer && from && to ? (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {holdingRef(fromId) && holdingRef(toId)
          ? `Switch: sells from ${from.name} and buys ${to.name} (realised gain is recorded on ${from.name}).`
          : holdingRef(toId)
            ? `Recorded as an investment into ${to.name}.`
            : `Recorded as a redemption from ${from.name} (realised gain is calculated).`}
      </p>
    ) : null;
  const totalLeaving =
    type === "transfer" && fee && !Number.isNaN(fee) && amount && !Number.isNaN(amount) && from ? (
      <div
        className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
        aria-live="polite"
      >
        <span>Total leaving {from.name}</span>
        <Money valueMinor={amount + fee} currency={from.currency} />
      </div>
    ) : null;
  const splitToggle = (
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
  );
  const splitFieldset = splitMode ? (
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
          className={!amount || remaining === 0 ? "text-muted-foreground" : "text-destructive"}
          aria-live="polite"
        >
          {!amount || Number.isNaN(amount) ? (
            "Enter the total first"
          ) : remaining === 0 ? (
            "Fully split"
          ) : (
            <>
              Remaining <Money valueMinor={remaining} currency={currency} colorNegative={false} />
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
  ) : null;
  const counterpartyField =
    type === "income" || type === "expense" ? (
      <FormField
        id="qa-counterparty"
        label={type === "income" ? "Payer (optional)" : "Payee (optional)"}
        error={err("counterparty")}
      >
        <Input id="qa-counterparty" autoComplete="off" {...register("counterparty")} />
      </FormField>
    ) : null;
  const tagsField = (
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
  );
  const notesField = (
    <FormField id="qa-notes" label="Notes (optional)" error={err("notes")}>
      <Textarea id="qa-notes" rows={2} {...register("notes")} />
    </FormField>
  );
  const rootError = errors.root ? (
    <p role="alert" className="text-sm text-destructive">
      {errors.root.message}
    </p>
  ) : null;

  const accountLabel = (value: string) => {
    const h = holdingRef(value);
    const item = h
      ? options.holdings.find((x) => x.id === h)
      : options.accounts.find((a) => a.id === value);
    if (!item) return null;
    const balance = "balanceMinor" in item ? item.balanceMinor : item.currentValueMinor;
    return (
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">{item.name}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {tileMoney(balance, item.currency, options.baseCurrency)}
        </span>
      </span>
    );
  };
  const keypadText = (text: string, digits: number, cur: string) => (
    <>
      <span className="min-w-0 font-mono text-xl break-all tabular-nums">
        {text.replace(
          /([+\-*/])/g,
          (o) => ` ${o === "*" ? "×" : o === "/" ? "÷" : o === "-" ? "−" : o} `,
        )}
      </span>
      {isCalculation(text) && evaluateAmountExpression(text, digits) !== null ? (
        <span className="ml-auto shrink-0 font-mono text-sm text-muted-foreground tabular-nums">
          = {formatMoney(evaluateAmountExpression(text, digits)!, cur)}
        </span>
      ) : null}
    </>
  );
  const moneyText = (minor: number | null, cur: string) =>
    minor !== null && !Number.isNaN(minor) ? (
      <span className="font-mono text-xl tabular-nums">{formatMoney(minor, cur)}</span>
    ) : null;
  const path = categoryId ? categoryPath(options.categories, categoryId) : null;
  const showFeeRow = type === "transfer" && (feeOpen || Boolean(fee));
  const moreFilled = [tagsValue, notesValue, counterpartyValue, fromBucket, toBucket].filter((v) =>
    Boolean(v && String(v).trim()),
  ).length;
  const moreHasError = ["counterparty", "tags", "notes", "fromBucket", "toBucket"].some((k) =>
    Boolean(err(k)),
  );
  const moreShown = moreOpen || moreHasError;
  const yesterdayKey = addDaysKey(options.todayKey, -1);

  const phoneRows = (
    <div className="grid">
      <TapRow
        id="qa-date"
        label="Date"
        placeholder="Choose a date"
        active={panel === "date"}
        error={err("date")}
        tone={tone}
        onClick={() => openPanel(panel === "date" ? null : "date")}
      >
        {date ? (
          <>
            {formatDateKey(date)}
            {date === options.todayKey || date === yesterdayKey ? (
              <span className="text-sm text-muted-foreground">
                · {date === options.todayKey ? "Today" : "Yesterday"}
              </span>
            ) : null}
          </>
        ) : null}
      </TapRow>
      {!byUnits ? (
        <TapRow
          id="qa-amount"
          label="Amount"
          placeholder="0.00"
          active={panel === "amount"}
          error={err("amountMinor")}
          tone={tone}
          onClick={() => openPanel(panel === "amount" ? null : "amount")}
          side={
            type === "transfer" ? (
              <RowSideButton pressed={showFeeRow} onClick={toggleFees}>
                Fees
              </RowSideButton>
            ) : undefined
          }
        >
          {panel === "amount" && expr
            ? keypadText(expr, amountDigits, currency)
            : moneyText(amount, currency)}
        </TapRow>
      ) : null}
      {showFeeRow ? (
        <TapRow
          id="qa-transfer-fee"
          label="Fee"
          placeholder={assetTransfer ? "0.00 · exit load or charge" : "0.00 · bank charge"}
          active={panel === "fee"}
          error={err("feeMinor")}
          tone={tone}
          onClick={() => openPanel(panel === "fee" ? null : "fee")}
        >
          {panel === "fee" && expr
            ? keypadText(expr, feeDigits, feeCurrency)
            : moneyText(fee, feeCurrency)}
        </TapRow>
      ) : null}
      {(type === "income" || type === "expense") && !(type === "expense" && splitMode) ? (
        <TapRow
          id="qa-category"
          label="Category"
          placeholder="Choose"
          active={panel === "category"}
          error={err("categoryId")}
          tone={tone}
          onClick={() => openPanel(panel === "category" ? null : "category")}
        >
          {path ? (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate">{path.main}</span>
              {path.sub ? (
                <>
                  <span className="text-muted-foreground" aria-hidden>
                    ›
                  </span>
                  <span className="truncate">{path.sub}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </TapRow>
      ) : null}
      {investment && holdingChoices.length ? (
        <TapRow
          id="qa-holding"
          label={type === "investment_income" ? "From asset" : "Asset"}
          placeholder="Choose an asset"
          active={panel === "holding"}
          error={err("holdingId")}
          tone={tone}
          onClick={() => openPanel(panel === "holding" ? null : "holding")}
        >
          {holdingId ? accountLabel(`${HOLDING_PREFIX}${holdingId}`) : null}
        </TapRow>
      ) : null}
      {showFrom ? (
        <TapRow
          id="qa-from"
          label={type === "expense" ? "Account" : "From"}
          placeholder="Choose"
          active={panel === "from"}
          error={err("fromAccountId")}
          tone={tone}
          onClick={() => openPanel(panel === "from" ? null : "from")}
        >
          {fromId ? accountLabel(fromId) : null}
        </TapRow>
      ) : null}
      {showTo ? (
        <TapRow
          id="qa-to"
          label={type === "income" ? "Account" : "To"}
          placeholder="Choose"
          active={panel === "to"}
          error={err("toAccountId")}
          tone={tone}
          onClick={() => openPanel(panel === "to" ? null : "to")}
          side={
            type === "transfer" ? (
              <RowSideButton
                label="Swap From and To"
                onClick={() => {
                  const f = getValues("fromAccountId");
                  setValue("fromAccountId", getValues("toAccountId"));
                  setValue("toAccountId", f);
                }}
              >
                <ArrowDownUp className="size-4" aria-hidden />
              </RowSideButton>
            ) : undefined
          }
        >
          {toId ? accountLabel(toId) : null}
        </TapRow>
      ) : null}
      <div className="grid min-h-14 grid-cols-[5.5rem_minmax(0,1fr)] items-center">
        <label htmlFor="qa-description" className="text-[15px] text-muted-foreground">
          Note
        </label>
        <input
          id="qa-description"
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={err("description") ? true : undefined}
          className="h-14 w-full min-w-0 rounded-none border-0 border-b bg-transparent text-[17px] outline-none focus-visible:border-b-2 focus-visible:border-foreground"
          {...register("description")}
          onFocus={() => {
            if (panel) openPanel(null);
          }}
        />
      </div>
      {err("description") ? (
        <p role="alert" className="pl-[5.5rem] text-xs text-destructive">
          {err("description")}
        </p>
      ) : null}
    </div>
  );

  const phoneMore = (
    <div className="grid gap-3">
      <button
        type="button"
        aria-expanded={moreShown}
        aria-controls="qa-more"
        onClick={() => setMoreOpen(!moreShown)}
        className="flex min-h-11 w-full items-center justify-between rounded-lg bg-muted px-3.5 text-sm font-medium"
      >
        <span>
          More details{" "}
          <span className="font-normal text-muted-foreground">
            · {moreFilled ? `${moreFilled} filled` : "optional"}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", moreShown && "rotate-180")}
          aria-hidden
        />
      </button>
      {moreShown ? (
        <div id="qa-more" className="grid gap-4">
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
          {type === "expense" ? splitToggle : null}
          {counterpartyField}
          {tagsField}
          {notesField}
          {!editing && options.templates.length ? templateField("qa-template-mobile") : null}
        </div>
      ) : null}
    </div>
  );

  const phonePanel =
    panel === "amount" || panel === "fee" ? (
      <KeypadPanel
        title={panel === "fee" ? "Fee" : "Amount"}
        digits={panel === "fee" ? feeDigits : amountDigits}
        onKey={(k) =>
          setExpr((e) => applyKeypadKey(e, k, panel === "fee" ? feeDigits : amountDigits))
        }
        onEquals={keypadEquals}
        onOk={keypadOk}
        onClose={() => openPanel(null)}
      />
    ) : panel === "date" ? (
      <CalendarPanel
        value={date}
        todayKey={options.todayKey}
        onPick={(key) => {
          setValue("date", key, { shouldDirty: true });
          clearErrors("date");
          setPanel(null);
        }}
        onClose={() => setPanel(null)}
      />
    ) : panel === "category" ? (
      <CategoryPanel
        tree={options.categories}
        kind={type === "income" ? "income" : "expense"}
        value={categoryId}
        onPick={(id) => {
          setValue("categoryId", id, { shouldDirty: true });
          clearErrors("categoryId");
          advance("category");
        }}
        onClose={() => setPanel(null)}
      />
    ) : panel === "holding" ? (
      <AccountPanel
        title={type === "investment_income" ? "From asset" : "Asset"}
        groups={[{ items: holdingChoices.map((h) => holdingTile(h, "")) }]}
        value={holdingId}
        baseCurrency={options.baseCurrency}
        onPick={(id) => {
          setValue("holdingId", id, { shouldDirty: true });
          clearErrors("holdingId");
          setHoldingChosen(true);
          advance("holding", true);
        }}
        onClose={() => setPanel(null)}
      />
    ) : panel === "from" || panel === "to" ? (
      <AccountPanel
        title={
          type === "transfer"
            ? panel === "from"
              ? "From"
              : "To"
            : panel === "from" && type !== "expense"
              ? "From account"
              : panel === "to" && type !== "income"
                ? "To account"
                : "Account"
        }
        groups={
          type === "transfer"
            ? [
                { label: "Accounts", items: options.accounts.map(accountTile) },
                {
                  label: "Assets",
                  items: transferHoldings.map((h) => holdingTile(h, HOLDING_PREFIX)),
                },
              ]
            : [{ items: options.accounts.map(accountTile) }]
        }
        value={panel === "from" ? fromId : toId}
        disabledValue={type === "transfer" ? (panel === "from" ? toId : fromId) : undefined}
        baseCurrency={options.baseCurrency}
        onPick={(id) => {
          const field = panel === "from" ? "fromAccountId" : "toAccountId";
          setValue(field, id, { shouldDirty: true });
          clearErrors(field);
          advance(panel);
        }}
        onClose={() => setPanel(null)}
      />
    ) : null;

  const phoneFields = (
    <>
      {typeTabs}
      {phoneRows}
      {investment ? (
        <InvestmentHeader
          control={control}
          type={type}
          holdings={holdingChoices}
          holding={holding}
          err={err}
          onDone={onDone}
          showPicker={false}
        />
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
      {previewBlock}
      {toAmountField}
      {assetTransferHint}
      {totalLeaving}
      {type === "expense" ? splitFieldset : null}
      {rootError}
      {phoneMore}
    </>
  );

  return (
    <form
      id="quick-add-form"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid gap-4 overflow-y-auto px-4 pb-4">
        {isMobile ? (
          phoneFields
        ) : (
          <>
            {/* Templates: first on desktop; phones put them last (amount first, docs/07 §5). */}
            {!editing && options.templates.length ? (
              <div className="hidden md:contents">{templateField("qa-template")}</div>
            ) : null}
            {typeTabs}

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
            {previewBlock}

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

            {toAmountField}

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
            {assetTransferHint}
            {totalLeaving}

            {(type === "income" || type === "expense") && !(type === "expense" && splitMode) ? (
              <FormField id="qa-category" label="Category" error={err("categoryId")}>
                <Controller
                  control={control}
                  name="categoryId"
                  render={({ field }) => (
                    <>
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
                {splitToggle}
                {splitFieldset}
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
            {counterpartyField}
            {tagsField}
            {notesField}
            {rootError}
          </>
        )}
      </div>
      {isMobile && panel ? (
        phonePanel
      ) : (
        <SheetFooter className="border-t pb-[calc(1rem+env(safe-area-inset-bottom)+var(--drawer-keyboard-inset,0px))] max-md:grid max-md:grid-cols-[1fr_auto] md:pb-4">
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Saving…" : editing ? "Save changes" : "Save"}
          </Button>
          {!editing ? (
            <Button
              type="submit"
              variant="outline"
              disabled={isSubmitting}
              className="w-full px-5 md:hidden"
              data-add-another="1"
            >
              Continue
            </Button>
          ) : null}
        </SheetFooter>
      )}
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
        {/* Phones: the hint is for keyboards, so it stays for screen readers only. */}
        <SheetDescription className="max-md:sr-only">
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
