"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// docs/07 §3 — many tabs become one row of segments that scrolls sideways (the only allowed
// horizontal scroll); the active segment is kept in view. 44px tall on phones.

export interface SegmentItem<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Render as a link (route tabs); otherwise a toggle button. */
  href?: string;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentItem<T>[];
  value: T;
  onValueChange?: (value: T) => void;
  "aria-label": string;
  /** Stretch segments to fill the row (few, short labels). */
  fill?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onValueChange,
  fill = false,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLElement | null>(null);

  // Scroll the row (never the page) so the active segment is visible.
  React.useEffect(() => {
    const row = rowRef.current;
    const el = activeRef.current;
    if (!row || !el) return;
    const left = el.offsetLeft; // the row is the offset parent (relative)
    if (left < row.scrollLeft) row.scrollLeft = left - 4;
    else if (left + el.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = left + el.offsetWidth - row.clientWidth + 4;
    }
  }, [value]);

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={aria["aria-label"]}
      className={cn(
        "relative flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-lg bg-muted p-1 [&::-webkit-scrollbar]:hidden",
        fill ? "w-full" : "w-fit",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        const cls = cn(
          "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-7 md:px-2.5",
          fill && "flex-1",
          active && "bg-background text-foreground shadow-sm",
        );
        const ref = (el: HTMLElement | null) => {
          if (active) activeRef.current = el;
        };
        return item.href ? (
          <Link
            key={item.value}
            ref={ref}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cls}
          >
            {item.label}
          </Link>
        ) : (
          <button
            key={item.value}
            ref={ref}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange?.(item.value)}
            className={cls}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
