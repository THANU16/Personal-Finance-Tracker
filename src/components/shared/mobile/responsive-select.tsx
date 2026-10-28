"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

// docs/07 §3 — long dropdowns (accounts, categories, holdings) become a bottom-sheet picker with
// search on phones. md+: the regular Select popover.

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  /** Options with the same group are listed under one heading, in first-seen order. */
  group?: string;
  /** Extra text matched by the search box. */
  keywords?: string;
}

export interface ResponsiveSelectProps {
  id?: string;
  value: string | null;
  onValueChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  /** Sheet heading on phones (defaults to the placeholder). */
  title?: string;
  /** Show the search box (phones) from this many options; 0 = always, Infinity = never. */
  searchFrom?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function groupOptions(options: PickerOption[]): { group: string | null; items: PickerOption[] }[] {
  const groups: { group: string | null; items: PickerOption[] }[] = [];
  for (const o of options) {
    const key = o.group ?? null;
    let g = groups.find((x) => x.group === key);
    if (!g) groups.push((g = { group: key, items: [] }));
    g.items.push(o);
  }
  return groups;
}

/** Case- and accent-insensitive match on label, description, group and keywords. */
export function matchesQuery(o: PickerOption, query: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm([o.label, o.description, o.group, o.keywords].filter(Boolean).join(" "));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function PickerSheet({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  title,
  searchFrom = 8,
  disabled,
  className,
  ...aria
}: ResponsiveSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const listId = React.useId();
  const selected = options.find((o) => o.value === value) ?? null;
  const visible = options.filter((o) => matchesQuery(o, query));
  const searchable = options.length >= searchFrom;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="dialog"
        aria-label={aria["aria-label"]}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-left text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? placeholder}</DialogTitle>
        </DialogHeader>
        {searchable ? (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search options"
              enterKeyHint="search"
              className="pl-9"
            />
          </div>
        ) : null}
        <div id={listId} role="listbox" aria-label={title ?? placeholder} className="-mx-4">
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No matches</p>
          ) : (
            groupOptions(visible).map((g) => (
              <div key={g.group ?? ""} role="group" aria-label={g.group ?? undefined}>
                {g.group ? (
                  <div className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {g.group}
                  </div>
                ) : null}
                {g.items.map((o) => {
                  const isSelected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onValueChange(o.value);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base">{o.label}</span>
                        {o.description ? (
                          <span className="block truncate text-sm text-muted-foreground">
                            {o.description}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? <Check className="size-5 text-primary" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DesktopSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  ...aria
}: ResponsiveSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onValueChange(v)}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full", className)}
        aria-label={aria["aria-label"]}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groupOptions(options).map((g) =>
          g.group ? (
            <SelectGroup key={g.group}>
              <SelectLabel>{g.group}</SelectLabel>
              {g.items.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            g.items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))
          ),
        )}
      </SelectContent>
    </Select>
  );
}

/** Select on desktop; on phones a field that opens a searchable bottom-sheet picker. */
export function ResponsiveSelect(props: ResponsiveSelectProps) {
  return useIsMobile() ? <PickerSheet {...props} /> : <DesktopSelect {...props} />;
}
