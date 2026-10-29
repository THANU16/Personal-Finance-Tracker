"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { FormField } from "@/components/shared/form-field";
import { MoneyInput } from "@/components/shared/money-input";
import { FilterChips, FilterSheet } from "@/components/shared/mobile/filter-sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatMoney } from "@/lib/format";
import type { DateRangePreset } from "@/domain/date-range";
import { CategorySelect, flattenCategories } from "@/modules/categories/components/category-select";
import type { CategoryNode } from "@/modules/categories/schemas";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "this_year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

const TYPES = [
  { value: "", label: "All types" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
  { value: "adjustment", label: "Adjustments" },
  { value: "debt_payment", label: "Loan payments" },
];

export interface FilterOptions {
  accounts: { id: string; name: string }[];
  categories: CategoryNode[];
  tags: string[];
  baseCurrency: string;
}

/** Filters synced to the URL (docs/05 §4). Every change resets to page 1. */
export function TransactionFilters({ accounts, categories, tags, baseCurrency }: FilterOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const [q, setQ] = React.useState(get("q"));
  const isMobile = useIsMobile();

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // Debounced text search
  React.useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [q, params, update]);

  const preset = (get("preset") || "this_month") as DateRangePreset;
  const minMinor = get("min") ? Number(get("min")) : null;
  const maxMinor = get("max") ? Number(get("max")) : null;
  const active =
    ["types", "account", "category", "tag", "min", "max", "q", "voided"].some((k) =>
      params.has(k),
    ) || preset !== "this_month";

  const searchBox = (
    <div className="relative flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        placeholder="Search"
        aria-label="Search transactions"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="pl-8"
      />
    </div>
  );
  const presetSelect = (
    <Select
      value={preset}
      onValueChange={(v) => update({ preset: String(v) === "this_month" ? null : String(v) })}
      items={PRESETS}
    >
      <SelectTrigger className="w-full" aria-label="Date range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRESETS.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const typeSelect = (
    <Select
      value={get("types")}
      onValueChange={(v) => update({ types: String(v ?? "") })}
      items={TYPES}
    >
      <SelectTrigger className="w-full" aria-label="Type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const accountSelect = (
    <Select
      value={get("account")}
      onValueChange={(v) => update({ account: String(v ?? "") })}
      items={[
        { value: "", label: "All accounts" },
        ...accounts.map((a) => ({ value: a.id, label: a.name })),
      ]}
    >
      <SelectTrigger className="w-full" aria-label="Account">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value="">All accounts</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const customRange = (
    <>
      <DatePicker
        value={get("from") || null}
        onChange={(v) => update({ from: v })}
        placeholder="From"
      />
      <DatePicker value={get("to") || null} onChange={(v) => update({ to: v })} placeholder="To" />
    </>
  );
  const categorySelect = (
    <CategorySelect
      aria-label="Category"
      tree={categories}
      kind={get("types") === "income" ? "income" : "expense"}
      value={get("category")}
      onChange={(v) => update({ category: v })}
      allowAll
    />
  );
  const tagSelect = (
    <Select
      value={get("tag")}
      onValueChange={(v) => update({ tag: String(v ?? "") })}
      items={[{ value: "", label: "All tags" }, ...tags.map((t) => ({ value: t, label: `#${t}` }))]}
    >
      <SelectTrigger className="w-full" aria-label="Tag">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value="">All tags</SelectItem>
        {tags.map((t) => (
          <SelectItem key={t} value={t}>
            #{t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const minInput = (
    <MoneyInput
      aria-label="Minimum amount"
      placeholder="Min"
      currency={baseCurrency}
      value={minMinor}
      onChange={(v) =>
        v === null || (!Number.isNaN(v) && v > 0)
          ? update({ min: v === null ? null : String(v) })
          : undefined
      }
    />
  );
  const maxInput = (
    <MoneyInput
      aria-label="Maximum amount"
      placeholder="Max"
      currency={baseCurrency}
      value={maxMinor}
      onChange={(v) =>
        v === null || (!Number.isNaN(v) && v > 0)
          ? update({ max: v === null ? null : String(v) })
          : undefined
      }
    />
  );
  const voidedSwitch = (
    <div className="flex items-center gap-2">
      <Switch
        id="show-voided"
        checked={get("voided") === "1"}
        onCheckedChange={(c) => update({ voided: c ? "1" : null })}
      />
      <Label htmlFor="show-voided">Show voided</Label>
    </div>
  );

  const clearAll = () => {
    setQ("");
    router.replace(pathname, { scroll: false });
  };

  // Active filters as removable chips (phones, docs/07 §3). Search stays visible, so not a chip.
  const categoryName = new Map(
    [...flattenCategories(categories, "expense"), ...flattenCategories(categories, "income")].map(
      (c) => [c.id, c.label] as const,
    ),
  );
  const chips = [
    ...(preset !== "this_month"
      ? [
          {
            key: "preset",
            label: PRESETS.find((p) => p.value === preset)?.label ?? preset,
            onRemove: () => update({ preset: null, from: null, to: null }),
          },
        ]
      : []),
    ...(get("types")
      ? [
          {
            key: "types",
            label: TYPES.find((t) => t.value === get("types"))?.label ?? get("types"),
            onRemove: () => update({ types: null }),
          },
        ]
      : []),
    ...(get("account")
      ? [
          {
            key: "account",
            label: accounts.find((a) => a.id === get("account"))?.name ?? "Account",
            onRemove: () => update({ account: null }),
          },
        ]
      : []),
    ...(get("category")
      ? [
          {
            key: "category",
            label: categoryName.get(get("category")) ?? "Category",
            onRemove: () => update({ category: null }),
          },
        ]
      : []),
    ...(get("tag")
      ? [{ key: "tag", label: `#${get("tag")}`, onRemove: () => update({ tag: null }) }]
      : []),
    ...(minMinor !== null
      ? [
          {
            key: "min",
            label: `≥ ${formatMoney(minMinor, baseCurrency)}`,
            onRemove: () => update({ min: null }),
          },
        ]
      : []),
    ...(maxMinor !== null
      ? [
          {
            key: "max",
            label: `≤ ${formatMoney(maxMinor, baseCurrency)}`,
            onRemove: () => update({ max: null }),
          },
        ]
      : []),
    ...(get("voided") === "1"
      ? [{ key: "voided", label: "Voided shown", onRemove: () => update({ voided: null }) }]
      : []),
  ];

  if (isMobile) {
    return (
      <div className="mb-3 grid gap-2">
        <div className="flex gap-2">
          {searchBox}
          <FilterSheet activeCount={chips.length} onClearAll={clearAll}>
            <FormField id="f-range" label="Date range">
              {presetSelect}
            </FormField>
            {preset === "custom" ? <div className="grid gap-3">{customRange}</div> : null}
            <FormField id="f-type" label="Type">
              {typeSelect}
            </FormField>
            <FormField id="f-account" label="Account">
              {accountSelect}
            </FormField>
            <FormField id="f-category" label="Category">
              {categorySelect}
            </FormField>
            <FormField id="f-tag" label="Tag">
              {tagSelect}
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              {minInput}
              {maxInput}
            </div>
            {voidedSwitch}
          </FilterSheet>
        </div>
        <FilterChips chips={chips} />
      </div>
    );
  }

  return (
    <div className="mb-4 grid gap-3 rounded-xl border p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex gap-2">{searchBox}</div>
        <div className="hidden sm:contents">
          {presetSelect}
          {typeSelect}
          {accountSelect}
        </div>
      </div>

      <div id="transaction-filters-more" className="hidden gap-3 sm:grid">
        {preset === "custom" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{customRange}</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>{categorySelect}</div>
          {tagSelect}
          {minInput}
          {maxInput}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {voidedSwitch}
          {active ? (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X aria-hidden /> Clear filters
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
