"use client";

import * as React from "react";
import { formatMoney } from "@/lib/format";
import {
  PickerPanel,
  SectionHeading,
  Tile,
  TileGrid,
} from "@/modules/transactions/components/phone-entry/picker-panel";

export interface AccountTileItem {
  value: string;
  name: string;
  balanceMinor: number;
  currency: string;
  /** Free part of an earmarked account (docs/04 §20); null when nothing is set aside. */
  freeMinor: number | null;
  /** E.g. "Opportunity money" for an Opportunity Fund account. */
  note?: string;
}

export interface AccountTileGroup {
  label?: string;
  items: AccountTileItem[];
}

/** Balance without the currency code when it is the base currency (tiles are narrow). */
export function tileMoney(minor: number, currency: string, baseCurrency: string): string {
  const text = formatMoney(minor, currency);
  return currency.toUpperCase() === baseCurrency.toUpperCase()
    ? text.replace(`${currency.toUpperCase()} `, "")
    : text;
}

/**
 * Account / asset tiles (owner decision, 2026-11-09: version B): name, balance and, for an account
 * with set-aside money, how much is free. One tap picks it.
 */
export function AccountPanel({
  title,
  groups,
  value,
  disabledValue,
  baseCurrency,
  onPick,
  onClose,
}: {
  title: string;
  groups: AccountTileGroup[];
  value: string;
  /** The other side of a transfer: cannot be picked twice. */
  disabledValue?: string;
  baseCurrency: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const filled = groups.filter((g) => g.items.length > 0);
  return (
    <PickerPanel title={title} onClose={onClose}>
      {filled.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nothing to choose yet.</p>
      ) : (
        filled.map((g) => (
          <React.Fragment key={g.label ?? "all"}>
            {g.label && filled.length > 1 ? <SectionHeading>{g.label}</SectionHeading> : null}
            <TileGrid label={g.label ?? title}>
              {g.items.map((a) => {
                const balance = tileMoney(a.balanceMinor, a.currency, baseCurrency);
                const free =
                  a.freeMinor !== null
                    ? `${tileMoney(a.freeMinor, a.currency, baseCurrency)} free`
                    : null;
                return (
                  <Tile
                    key={a.value}
                    selected={value === a.value}
                    disabled={disabledValue === a.value}
                    onClick={() => onPick(a.value)}
                    label={[a.name, balance, free ?? a.note].filter(Boolean).join(", ")}
                  >
                    <span>{a.name}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {balance}
                    </span>
                    {free ? (
                      <span className="text-[11px] text-amber-700 dark:text-amber-400">{free}</span>
                    ) : a.note ? (
                      <span className="text-[11px] text-muted-foreground">{a.note}</span>
                    ) : null}
                  </Tile>
                );
              })}
            </TileGrid>
          </React.Fragment>
        ))
      )}
    </PickerPanel>
  );
}
