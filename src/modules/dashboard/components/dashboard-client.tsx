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
import type { SafeToSpend } from "@/modules/dashboard/queries";

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
