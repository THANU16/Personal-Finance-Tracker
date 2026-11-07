"use client";

import { FormField } from "@/components/shared/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OpportunityKeepIn } from "@/modules/sip/constants";

export interface RouteValue {
  /** null = the plan's source account. */
  fromAccountId: string | null;
  keepIn: OpportunityKeepIn;
  accountId: string | null;
  holdingId: string | null;
}

const SOURCE = "__source__";

function Pick({
  id,
  label,
  value,
  items,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string | null;
  items: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <FormField id={id} label={label}>
      <Select value={value ?? ""} onValueChange={(v) => v && onChange(v)} items={items}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/**
 * docs/04 §7 (owner request, 2026-11-07): where a SIP's opportunity-fund share comes from and is
 * kept — reserved in the same account (no money moves), transferred to another account, or bought
 * into an asset. Used by the plan editor (default) and Execute (this period).
 */
export function OpportunityRouteFields({
  idPrefix,
  value,
  onChange,
  source,
  accounts,
  holdings,
}: {
  idPrefix: string;
  value: RouteValue;
  onChange: (next: RouteValue) => void;
  source: { id: string; name: string } | null;
  accounts: { id: string; name: string; opportunityAccount?: boolean }[];
  holdings: { id: string; name: string }[];
}) {
  const fromId = value.fromAccountId ?? source?.id ?? null;
  const fromName =
    accounts.find((a) => a.id === fromId)?.name ?? source?.name ?? "the source account";
  const fromItems = [
    ...(source ? [{ value: SOURCE, label: `${source.name} (SIP source)` }] : []),
    ...accounts.filter((a) => a.id !== source?.id).map((a) => ({ value: a.id, label: a.name })),
  ];
  const keepItems = [
    { value: "same", label: `Keep it in ${fromName}` },
    { value: "account", label: "Move it to another account" },
    { value: "holding", label: "Put it in an asset" },
  ];
  const toAccounts = accounts
    .filter((a) => a.id !== fromId)
    .map((a) => ({
      value: a.id,
      label: a.opportunityAccount ? `${a.name} (Opportunity Fund account)` : a.name,
    }));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Pick
        id={`${idPrefix}-from`}
        label="From"
        value={value.fromAccountId ?? (source ? SOURCE : null)}
        items={fromItems}
        onChange={(v) => onChange({ ...value, fromAccountId: v === SOURCE ? null : v })}
      />
      <Pick
        id={`${idPrefix}-keep`}
        label="Keep it"
        value={value.keepIn}
        items={keepItems}
        onChange={(v) => onChange({ ...value, keepIn: v as OpportunityKeepIn })}
      />
      {value.keepIn === "account" ? (
        <Pick
          id={`${idPrefix}-account`}
          label="In account"
          value={value.accountId}
          items={toAccounts}
          placeholder="Choose an account"
          onChange={(v) => onChange({ ...value, accountId: v })}
        />
      ) : value.keepIn === "holding" ? (
        <Pick
          id={`${idPrefix}-holding`}
          label="In asset"
          value={value.holdingId}
          items={holdings.map((h) => ({ value: h.id, label: h.name }))}
          placeholder="Choose an asset"
          onChange={(v) => onChange({ ...value, holdingId: v })}
        />
      ) : (
        <p className="self-end pb-2 text-xs text-muted-foreground">
          No money moves: this much of {fromName} is reserved as opportunity money.
        </p>
      )}
    </div>
  );
}
