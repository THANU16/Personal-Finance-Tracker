"use client";

import { Info, MoreHorizontal, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createManualSnapshotAction, rebuildHistoryAction } from "@/modules/dashboard/actions";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NetWorthBridgeData, SafeToSpend } from "@/modules/dashboard/queries";

/** Net worth card menu: Rebuild history · Take a snapshot now. */
export function NetWorthMenu() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: "rebuild" | "snapshot") {
    setBusy(true);
    const result =
      action === "rebuild" ? await rebuildHistoryAction() : await createManualSnapshotAction();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      action === "rebuild"
        ? `History rebuilt: ${"months" in result.data ? result.data.months : 0} month-end snapshots`
        : "Snapshot saved",
    );
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Net worth options" disabled={busy} />
        }
      >
        {busy ? <RefreshCw className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run("rebuild")}>Rebuild history</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("snapshot")}>
          Take a snapshot now
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Safe to spend with its breakdown (docs/04 §21); negative shows a warning. */
export function SafeToSpendValue({ data }: { data: SafeToSpend }) {
  const negative = data.safeMinor < 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Safe to spend</span>
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label="How safe to spend is calculated" />
            }
          >
            <Info aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="grid w-80 gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <span>Free cash</span>
              <Money valueMinor={data.freeCashMinor} currency={data.currency} />
            </div>
            {data.items.map((i) => (
              <div key={i.id} className="flex justify-between gap-3 text-muted-foreground">
                <span className="truncate">
                  {i.title} · {i.dueDate}
                </span>
                <Money valueMinor={-(i.outflowMinor ?? 0)} currency={data.currency} />
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t pt-2 font-medium">
              <span>Safe to spend until {data.monthEnd}</span>
              <Money valueMinor={data.safeMinor} currency={data.currency} />
            </div>
            <p className="text-xs text-muted-foreground">
              Free cash minus money already committed this month (card dues now; SIPs, EMIs and
              recurring bills as those features arrive).
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <span className="text-2xl font-semibold tracking-tight">
        <Money valueMinor={data.safeMinor} currency={data.currency} />
      </span>
      {negative ? (
        <span role="status" className="flex items-center gap-1 text-xs text-destructive">
          <TriangleAlert className="size-3.5" aria-hidden /> Committed outflows exceed your free
          cash
        </span>
      ) : null}
    </div>
  );
}

const BRIDGE_ROWS = [
  ["savedMinor", "Saved (income − expense)"],
  ["marketGainMinor", "Investments (market gain)"],
  ["otherMinor", "Currency & adjustments"],
] as const;

/**
 * docs/04 §25.1 — why net worth changed: this month or the dashboard range (a local switch; both
 * are computed on the server). Bars grow right (added) or left (reduced) from the middle.
 */
export function NetWorthBridgeView({
  currency,
  month,
  range,
  rangeLabel,
}: {
  currency: string;
  month: NetWorthBridgeData;
  range: NetWorthBridgeData;
  rangeLabel: string;
}) {
  const [tab, setTab] = useState<"month" | "range">("month");
  const d = tab === "month" ? month : range;
  const max = Math.max(1, ...BRIDGE_ROWS.map(([k]) => Math.abs(d[k])));
  const up = d.changeMinor >= 0;
  return (
    <div className="grid gap-4">
      <div
        role="group"
        aria-label="Period"
        className="grid w-full grid-cols-2 rounded-lg bg-muted p-0.5 sm:w-fit"
      >
        {(
          [
            ["month", "This month"],
            ["range", rangeLabel],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "min-h-11 rounded-md px-3 text-sm font-medium text-muted-foreground md:min-h-8",
              tab === key && "bg-background text-foreground shadow-sm",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-0.5">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            up ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {up ? "▲ " : "▼ "}
          <Money valueMinor={d.changeMinor} currency={currency} signed colorNegative={false} />
          {d.changePctBp !== null ? ` (${formatPercentBp(d.changePctBp, { signed: true })})` : ""}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          <Money valueMinor={d.startMinor} currency={currency} compact /> on {shortDay(d.from, -1)}{" "}
          → <Money valueMinor={d.endMinor} currency={currency} compact /> on {shortDay(d.to)}
        </span>
      </div>
      <ul className="grid gap-3" aria-label="Where the change came from">
        {BRIDGE_ROWS.map(([key, label]) => {
          const v = d[key];
          const width = `${Math.max(1, (Math.abs(v) / max) * 50)}%`;
          return (
            <li
              key={key}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[13rem_1fr_9rem]"
            >
              <span className="text-sm">{label}</span>
              <span
                className={cn(
                  "text-right text-sm tabular-nums md:order-last",
                  v >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
                )}
              >
                <Money valueMinor={v} currency={currency} signed colorNegative={false} />
              </span>
              <span
                className="relative col-span-2 h-2 rounded-full bg-muted md:col-span-1"
                aria-hidden
              >
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-border" />
                <span
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    v >= 0 ? "left-1/2 bg-emerald-600" : "right-1/2 bg-red-500",
                  )}
                  style={{ width }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-dashed pt-3 text-xs text-muted-foreground">
        Paying a loan moves cash to the loan, so it does not change net worth.
      </p>
    </div>
  );
}

/** "31 Oct" (offset −1: the day before `key`). */
function shortDay(key: string, offsetDays = 0): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
