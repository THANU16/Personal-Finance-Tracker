"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PICKER_PANEL_ID } from "@/modules/transactions/components/phone-entry/picker-panel";

export type RowTone = "income" | "expense" | "neutral";

const ACTIVE_LINE: Record<RowTone, string> = {
  income: "border-blue-600 dark:border-blue-400",
  expense: "border-red-600 dark:border-red-400",
  neutral: "border-foreground",
};

/**
 * One line of the phone Quick add form: a label and the chosen value. Tapping opens its picker
 * in the bottom panel; the open row is underlined in the type's colour.
 */
export function TapRow({
  id,
  label,
  placeholder,
  active,
  error,
  tone,
  onClick,
  side,
  children,
}: {
  id: string;
  label: string;
  placeholder: string;
  active: boolean;
  error?: string;
  tone: RowTone;
  onClick: () => void;
  /** A button at the end of the row (Fees, swap). */
  side?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const empty = children === null || children === undefined || children === false;
  return (
    <div className="grid gap-0.5">
      <div className="flex items-stretch gap-2">
        <button
          id={id}
          type="button"
          onClick={onClick}
          aria-expanded={active}
          aria-controls={active ? PICKER_PANEL_ID : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="grid min-h-14 min-w-0 flex-1 grid-cols-[5.5rem_minmax(0,1fr)] items-stretch text-left focus-visible:outline-none [&:focus-visible>span:last-child]:bg-muted/60"
        >
          <span className="self-center text-[15px] text-muted-foreground">{label}</span>
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 border-b py-1.5 text-[17px]",
              active && cn("border-b-2", ACTIVE_LINE[tone]),
              error && "border-b-2 border-destructive",
            )}
          >
            {empty ? (
              <span className="text-[15px] text-muted-foreground">{placeholder}</span>
            ) : (
              children
            )}
          </span>
        </button>
        {side}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="pl-[5.5rem] text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Small outline button at the end of a row (e.g. "Fees"). */
export function RowSideButton({
  pressed,
  onClick,
  children,
  label,
}: {
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      className={cn(
        "grid min-h-11 min-w-11 shrink-0 place-items-center self-center rounded-lg border px-3 text-sm font-medium",
        pressed && "border-foreground",
      )}
    >
      {children}
    </button>
  );
}
