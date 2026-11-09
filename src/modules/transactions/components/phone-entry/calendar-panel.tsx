"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelTool, PickerPanel } from "@/modules/transactions/components/phone-entry/picker-panel";

// Date keys (YYYY-MM-DD) are calendar days in the user's timezone; UTC dates are used only for
// day-of-week and month arithmetic, so the device timezone never shifts a day.
const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
};
const keyOf = (date: Date) => date.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
export const addDaysKey = (key: string, days: number) => {
  const { y, m, d } = parse(key);
  return keyOf(utc(y, m, d + days));
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthLabel = (y: number, m: number) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    utc(y, m, 1),
  );
const dayLabel = (key: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(parse(key).y, parse(key).m, parse(key).d));

/** "Mon, 9 Nov 2026" for the Date row. */
export function formatDateKey(key: string): string {
  const { y, m, d } = parse(key);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(y, m, d));
}

/**
 * Month calendar in the bottom panel (owner request, 2026-11-09): Sunday first, Sunday red and
 * Saturday blue, today outlined; Yesterday and Today in the header. Tapping a day picks it.
 */
export function CalendarPanel({
  value,
  todayKey,
  onPick,
  onClose,
}: {
  value: string;
  todayKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const start = parse(value || todayKey);
  const [month, setMonth] = React.useState({ y: start.y, m: start.m });
  const first = utc(month.y, month.m, 1);
  const gridStart = utc(month.y, month.m, 1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getTime() + i * 86_400_000);
    return {
      key: keyOf(date),
      day: date.getUTCDate(),
      dow: date.getUTCDay(),
      inMonth: date.getUTCMonth() + 1 === month.m,
    };
  });
  const shift = (n: number) => {
    const d = utc(month.y, month.m + n, 1);
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };
  return (
    <PickerPanel
      title="Date"
      onClose={onClose}
      tools={
        <>
          <PanelTool onClick={() => onPick(addDaysKey(todayKey, -1))}>Yesterday</PanelTool>
          <PanelTool onClick={() => onPick(todayKey)}>Today</PanelTool>
        </>
      }
    >
      <div className="flex h-11 items-center justify-between border-b px-1">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="grid size-11 place-items-center"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <strong className="font-semibold" aria-live="polite">
          {monthLabel(month.y, month.m)}
        </strong>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="grid size-11 place-items-center"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 border-b bg-muted py-1 text-center text-xs" aria-hidden>
        {WEEKDAYS.map((w, i) => (
          <span
            key={w}
            className={cn(
              "text-muted-foreground",
              i === 0 && "text-red-600 dark:text-red-400",
              i === 6 && "text-blue-600 dark:text-blue-400",
            )}
          >
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
        {days.map((d) => {
          const selected = d.key === value;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onPick(d.key)}
              aria-label={dayLabel(d.key)}
              aria-pressed={selected}
              aria-current={d.key === todayKey ? "date" : undefined}
              className={cn(
                "h-10 border-r border-b text-base tabular-nums",
                d.dow === 0 && "text-red-600 dark:text-red-400",
                d.dow === 6 && "text-blue-600 dark:text-blue-400",
                !d.inMonth && "bg-muted text-muted-foreground",
                d.key === todayKey && "ring-2 ring-blue-600 ring-inset dark:ring-blue-400",
                selected && "bg-primary font-semibold text-primary-foreground",
              )}
            >
              {d.day}
            </button>
          );
        })}
      </div>
    </PickerPanel>
  );
}
