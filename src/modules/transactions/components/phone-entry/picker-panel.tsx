"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const PICKER_PANEL_ID = "qa-picker-panel";

/**
 * Phones (owner request, 2026-11-09; docs/07 §5): the bottom panel of Quick add that holds the
 * keypad, calendar, category or account tiles. It replaces the sticky Save bar while open, so the
 * form above stays visible and the phone keyboard never opens for these fields.
 */
export function PickerPanel({
  title,
  tools,
  onClose,
  children,
}: {
  title: React.ReactNode;
  tools?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  return (
    <section
      id={PICKER_PANEL_ID}
      aria-labelledby={titleId}
      className="flex h-[min(22.5rem,52dvh)] shrink-0 flex-col border-t bg-background pb-[env(safe-area-inset-bottom)] motion-safe:animate-in motion-safe:duration-150 motion-safe:slide-in-from-bottom-4"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 bg-primary pr-1 pl-4 text-primary-foreground">
        <h2 id={titleId} className="flex min-w-0 items-center gap-1 text-base font-semibold">
          {title}
        </h2>
        <div className="flex shrink-0 items-center">
          {tools}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 place-items-center rounded-md focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  );
}

/** A small text button in the panel header (Today, Yesterday). */
export function PanelTool({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 rounded-md px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

/** Three columns of equal tiles separated by hairlines (category and account pickers). */
export function TileGrid({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-3 [&>*:nth-child(3n)]:border-r-0"
    >
      {children}
    </div>
  );
}

export function Tile({
  selected,
  disabled,
  onClick,
  children,
  label,
}: {
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Accessible name when the visible content has extra lines (balance, free). */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        "flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 border-r border-b px-2 py-2.5 text-center text-[15px] leading-tight break-words active:bg-muted disabled:opacity-40",
        selected && "bg-muted font-semibold ring-2 ring-foreground ring-inset",
      )}
    >
      {children}
    </button>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b bg-muted px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}
