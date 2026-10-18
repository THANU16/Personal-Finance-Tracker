"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { MoneyInput } from "@/components/shared/money-input";
import type { DateRangePreset } from "@/domain/date-range";
import { CategorySelect } from "@/modules/categories/components/category-select";
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
  const [expanded, setExpanded] = React.useState(false);

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

  return (
    <div className="mb-4 grid gap-3 rounded-xl border p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex gap-2">
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
          {/* Phones: the other filters fold away behind this toggle */}
          <Button
            type="button"
            variant="outline"
            className="sm:hidden"
            aria-expanded={expanded}
            aria-controls="transaction-filters-more"
            onClick={() => setExpanded((e) => !e)}
          >
            <SlidersHorizontal aria-hidden /> Filters{active ? " •" : ""}
          </Button>
        </div>
        <div className={cn(expanded ? "contents" : "hidden", "sm:contents")}>
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
        </div>
      </div>

      <div
        id="transaction-filters-more"
        className={cn(expanded ? "grid" : "hidden", "gap-3 sm:grid")}
      >
        {preset === "custom" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DatePicker
              value={get("from") || null}
              onChange={(v) => update({ from: v })}
              placeholder="From"
            />
            <DatePicker
              value={get("to") || null}
              onChange={(v) => update({ to: v })}
              placeholder="To"
            />
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div aria-label="Category">
            <CategorySelect
              tree={categories}
              kind={get("types") === "income" ? "income" : "expense"}
              value={get("category")}
              onChange={(v) => update({ category: v })}
              allowAll
            />
          </div>
          <Select
            value={get("tag")}
            onValueChange={(v) => update({ tag: String(v ?? "") })}
            items={[
              { value: "", label: "All tags" },
              ...tags.map((t) => ({ value: t, label: `#${t}` })),
            ]}
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
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="show-voided"
              checked={get("voided") === "1"}
              onCheckedChange={(c) => update({ voided: c ? "1" : null })}
            />
            <Label htmlFor="show-voided">Show voided</Label>
          </div>
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                router.replace(pathname, { scroll: false });
              }}
            >
              <X aria-hidden /> Clear filters
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
