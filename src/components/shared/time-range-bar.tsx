"use client";

import { CalendarRange, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { DatePicker } from "@/components/shared/date-picker";
import { FilterSheet } from "@/components/shared/mobile/filter-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  GRANULARITIES,
  MAX_BUCKETS_WARNING,
  type Granularity,
  type RangeView,
} from "@/domain/date-range";
import { useTimeRange } from "@/lib/use-time-range";
import { cn } from "@/lib/utils";

const PRESETS = [
  ["today", "Today"],
  ["7d", "7D"],
  ["30d", "30D"],
  ["3m", "3M"],
  ["6m", "6M"],
  ["ytd", "YTD"],
  ["1y", "1Y"],
  ["all", "All"],
] as const;

const G_LABEL: Record<Granularity, string> = { day: "Day", week: "Week", month: "Month" };

function Segmented({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // Phones: one row that scrolls sideways (docs/07 §3); md+: wraps as before.
    <div
      role="group"
      aria-label={label}
      className="flex max-w-full [scrollbar-width:none] flex-nowrap overflow-x-auto rounded-lg bg-muted p-0.5 md:max-w-none md:flex-wrap md:overflow-visible"
    >
      {children}
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "min-h-11 min-w-11 shrink-0 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 md:min-w-0 md:shrink md:px-2.5",
        active && "bg-background text-foreground shadow-sm",
      )}
    >
      {children}
    </button>
  );
}

/**
 * docs/05 §2 / docs/04 §22 — drives every chart on the page through the URL
 * (presets, custom range, Day/Week/Month, compare with the previous period).
 */
export function TimeRangeBar({ view }: { view: RangeView }) {
  const { pending, setPreset, setCustom, setGranularity, setCompare } = useTimeRange();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(view.range.from);
  const [to, setTo] = useState(view.range.to);

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
      aria-busy={pending}
      data-testid="time-range-bar"
    >
      <Segmented label="Time range">
        {PRESETS.map(([key, text]) => (
          <SegButton key={key} active={view.preset === key} onClick={() => setPreset(key)}>
            {text}
          </SegButton>
        ))}
        <Popover
          open={open}
          onOpenChange={(next) => {
            // Start from the range on screen, not the one the bar first mounted with.
            if (next) {
              setFrom(view.range.from);
              setTo(view.range.to);
            }
            setOpen(next);
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-pressed={view.preset === "custom"}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 md:shrink md:px-2.5",
                  view.preset === "custom" && "bg-background text-foreground shadow-sm",
                )}
              />
            }
          >
            <CalendarRange className="size-3.5" aria-hidden />
            {view.preset === "custom" ? `${view.range.from} – ${view.range.to}` : "Custom"}
          </PopoverTrigger>
          <PopoverContent align="start" className="grid w-72 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="range-from">From</Label>
              <DatePicker id="range-from" value={from} onChange={(v) => v && setFrom(v)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="range-to">To</Label>
              <DatePicker id="range-to" value={to} onChange={(v) => v && setTo(v)} />
            </div>
            <Button
              onClick={() => {
                setCustom(from, to);
                setOpen(false);
              }}
            >
              Apply range
            </Button>
          </PopoverContent>
        </Popover>
      </Segmented>

      {/* Phones: granularity and compare live behind an "Options" chip; md+: inline as before. */}
      <FilterSheet label="Options" title="Chart options" activeCount={view.compare ? 1 : 0}>
        <Segmented label="Granularity">
          {GRANULARITIES.map((g) => (
            <SegButton key={g} active={view.granularity === g} onClick={() => setGranularity(g)}>
              {G_LABEL[g]}
            </SegButton>
          ))}
        </Segmented>

        <div className="flex items-center gap-2">
          <Switch
            id="range-compare"
            checked={view.compare}
            onCheckedChange={(on) => setCompare(on)}
          />
          <Label htmlFor="range-compare" className="font-normal">
            Compare with previous period
          </Label>
        </div>
      </FilterSheet>

      <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {view.range.from} – {view.range.to} · {view.bucketCount}{" "}
        {G_LABEL[view.granularity].toLowerCase()}
        {view.bucketCount === 1 ? "" : "s"}
      </span>
      {view.tooManyBuckets ? (
        <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5" aria-hidden /> More than {MAX_BUCKETS_WARNING} points
          — a weekly or monthly view reads better.
        </span>
      ) : null}
    </div>
  );
}
