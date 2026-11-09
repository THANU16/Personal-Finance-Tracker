"use client";

import * as React from "react";
import { Delete } from "lucide-react";
import type { KeypadKey } from "@/domain/amount-expression";
import { cn } from "@/lib/utils";
import { PickerPanel } from "@/modules/transactions/components/phone-entry/picker-panel";

type PadKey = KeypadKey | "=" | "ok";

const KEYS: { key: PadKey; text: React.ReactNode; label?: string; kind?: "op" | "ok" | "soft" }[] =
  [
    { key: "+", text: "+", label: "Plus", kind: "op" },
    { key: "-", text: "−", label: "Minus", kind: "op" },
    { key: "*", text: "×", label: "Times", kind: "op" },
    { key: "/", text: "÷", label: "Divided by", kind: "op" },
    { key: "7", text: "7" },
    { key: "8", text: "8" },
    { key: "9", text: "9" },
    { key: "=", text: "=", label: "Equals", kind: "op" },
    { key: "4", text: "4" },
    { key: "5", text: "5" },
    { key: "6", text: "6" },
    { key: ".", text: ".", label: "Decimal point", kind: "op" },
    { key: "1", text: "1" },
    { key: "2", text: "2" },
    { key: "3", text: "3" },
    { key: "back", text: <Delete className="size-6" aria-hidden />, label: "Delete", kind: "op" },
    { key: "clear", text: "Clear", kind: "soft" },
    { key: "0", text: "0" },
    { key: "00", text: "00", label: "Double zero" },
    { key: "ok", text: "OK", kind: "ok" },
  ];

/**
 * Calculator keypad (owner request, 2026-11-09): digits, + − × ÷ and =; OK evaluates the sum and
 * moves to the next field. The phone keyboard never opens for amounts.
 */
export function KeypadPanel({
  title,
  digits,
  onKey,
  onEquals,
  onOk,
  onClose,
}: {
  title: string;
  digits: number;
  onKey: (key: KeypadKey) => void;
  onEquals: () => void;
  onOk: () => void;
  onClose: () => void;
}) {
  return (
    <PickerPanel title={title} onClose={onClose}>
      <div
        className="grid h-full grid-cols-4 grid-rows-5"
        role="group"
        aria-label={`${title} keypad`}
      >
        {KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            aria-label={k.label}
            disabled={digits === 0 && k.key === "."}
            onClick={() => (k.key === "ok" ? onOk() : k.key === "=" ? onEquals() : onKey(k.key))}
            className={cn(
              "grid place-items-center border-r border-b font-mono text-2xl tabular-nums select-none active:brightness-95 disabled:opacity-40 [&:nth-child(4n)]:border-r-0",
              k.kind === "op" && "bg-muted",
              k.kind === "soft" && "bg-muted font-sans text-sm text-muted-foreground",
              k.kind === "ok" &&
                "bg-primary font-sans text-lg font-semibold text-primary-foreground",
              !k.kind && "bg-background",
            )}
          >
            {k.text}
          </button>
        ))}
      </div>
    </PickerPanel>
  );
}
