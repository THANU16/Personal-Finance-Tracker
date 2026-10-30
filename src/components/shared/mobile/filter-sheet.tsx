"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobileOrUnknown } from "@/hooks/use-mobile";

// docs/07 §3 — filter bars become a "Filter" chip that opens a bottom sheet on phones; the active
// filters show as removable chips under the page title. md+: the filter controls render inline.

export interface FilterSheetProps {
  /** Number of active filters, shown on the chip. */
  activeCount: number;
  /** The filter controls (the same ones the desktop bar shows). */
  children: React.ReactNode;
  onClearAll?: () => void;
  title?: string;
  /** Chip text (default "Filter"). */
  label?: string;
}

export function FilterSheet({
  activeCount,
  children,
  onClearAll,
  title = "Filters",
  label = "Filter",
}: FilterSheetProps) {
  const isMobile = useIsMobileOrUnknown();
  const [open, setOpen] = React.useState(false);
  const chip = (
    <Button
      type="button"
      variant={activeCount ? "secondary" : "outline"}
      className={isMobile === null ? "rounded-full md:hidden" : "rounded-full"}
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
    >
      <SlidersHorizontal aria-hidden />
      {label}
      {activeCount ? ` (${activeCount})` : ""}
    </Button>
  );
  // Before hydration (server HTML): the chip on phones, the inline controls from md, so neither
  // layout shifts when React decides (docs/07 §8).
  if (isMobile === null) {
    return (
      <>
        {chip}
        <div className="contents max-md:hidden">{children}</div>
      </>
    );
  }
  if (!isMobile) return <>{children}</>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {chip}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">{children}</div>
        <DialogFooter>
          <DialogClose render={<Button className="w-full" />}>Done</DialogClose>
          {onClearAll ? (
            <Button type="button" variant="ghost" onClick={onClearAll} disabled={!activeCount}>
              Clear all
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Active filters as removable chips (phones only; desktop shows the controls themselves). */
export function FilterChips({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-2 md:hidden">
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={chip.onRemove}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-muted/50 pr-3 pl-4 text-sm"
          >
            {chip.label}
            <X className="size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">Remove filter</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
