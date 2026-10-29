"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { PriceInput } from "@/components/shared/price-input";
import { isBigChange } from "@/domain/holdings";
import { unitsValueMinor } from "@/domain/redemption";
import { vizColor } from "@/lib/viz-palette";
import { formatPercentBp, formatUnits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bulkUpdateValuesAction } from "@/modules/holdings/actions";
import { StaleBadge } from "@/modules/holdings/components/holdings-table";
import type { ValueUpdateRow } from "@/modules/holdings/queries";

const day = (key: string) => format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

interface Entry {
  value: number | null;
  price: number | null;
  confirm: boolean;
}

/** Bulk update (docs/05 §5): only edited rows are saved, all in one DB transaction. */
export function UpdateValuesForm({
  rows,
  bigChangeThresholdBp,
  today,
}: {
  rows: ValueUpdateRow[];
  bigChangeThresholdBp: number;
  today: string;
}) {
  const router = useRouter();
  const [date, setDate] = React.useState<string | null>(today);
  const [entries, setEntries] = React.useState<Record<string, Entry>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const entry = (id: string): Entry => entries[id] ?? { value: null, price: null, confirm: false };
  const update = (id: string, patch: Partial<Entry>) =>
    setEntries((prev) => ({ ...prev, [id]: { ...entry(id), ...patch } }));

  const byPrice = (r: ValueUpdateRow) => r.trackUnits && r.units !== null;
  const newValue = (r: ValueUpdateRow): number | null => {
    const e = entry(r.id);
    if (byPrice(r))
      return e.price && !Number.isNaN(e.price) ? unitsValueMinor(r.units!, e.price) : null;
    return e.value !== null && !Number.isNaN(e.value) ? e.value : null;
  };
  const changed = rows.filter((r) => newValue(r) !== null);
  const needsTick = changed.filter(
    (r) =>
      isBigChange(r.currentValueMinor, newValue(r)!, bigChangeThresholdBp) && !entry(r.id).confirm,
  );

  async function save() {
    if (!date || changed.length === 0) return;
    setPending(true);
    const result = await bulkUpdateValuesAction({
      date,
      rows: changed.map((r) => ({
        holdingId: r.id,
        ...(byPrice(r) ? { priceMinorE4: entry(r.id).price } : { valueMinor: entry(r.id).value }),
        confirmBigChange: entry(r.id).confirm,
      })),
    });
    setPending(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        const m = /^rows\.(\d+)\./.exec(key);
        const row = m ? changed[Number(m[1])] : undefined;
        if (row) mapped[row.id] = messages[0] ?? "";
      }
      setErrors(mapped);
      toast.error(result.error.message);
      return;
    }
    setErrors({});
    setEntries({});
    toast.success(`${result.data.updated} value${result.data.updated === 1 ? "" : "s"} updated`);
    router.push("/assets");
  }

  // Phones (docs/07 §5 Update values): Save all is pinned above the tab bar, or above the keyboard.
  const isMobile = useIsMobile();
  const keyboard = useKeyboardInset();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <FormField id="bulk-date" label="Values as of">
            <DatePicker id="bulk-date" value={date} onChange={setDate} />
          </FormField>
        </div>
        <div
          style={isMobile && keyboard > 0 ? { bottom: keyboard } : undefined}
          className="flex items-center gap-3 text-sm text-muted-foreground max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-30 max-md:justify-between max-md:border-t max-md:bg-background/95 max-md:px-4 max-md:py-3 max-md:backdrop-blur"
        >
          {changed.length} changed
          <Button
            onClick={() => void save()}
            disabled={pending || changed.length === 0 || needsTick.length > 0}
          >
            {pending ? "Saving…" : "Save all"}
          </Button>
        </div>
      </div>
      {needsTick.length > 0 ? (
        <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
          {needsTick.length} row{needsTick.length === 1 ? " changes" : "s change"} by more than{" "}
          {formatPercentBp(bigChangeThresholdBp)} — tick to confirm.
        </p>
      ) : null}
      <div className="rounded-xl border max-md:rounded-none max-md:border-0">
        <Table className="max-md:block">
          <TableHeader className="max-md:hidden">
            <TableRow>
              <TableHead>Holding</TableHead>
              <TableHead className="text-right">Invested</TableHead>
              <TableHead className="text-right">Last value</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead className="w-56">New value</TableHead>
              <TableHead className="w-32 pr-4 text-right">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:grid max-md:gap-3">
            {rows.map((r) => {
              const nv = newValue(r);
              const big = nv !== null && isBigChange(r.currentValueMinor, nv, bigChangeThresholdBp);
              const delta = nv !== null ? nv - r.currentValueMinor : null;
              const deltaBp =
                delta !== null && r.currentValueMinor > 0
                  ? Math.round((delta * 10_000) / r.currentValueMinor)
                  : null;
              return (
                <TableRow
                  key={r.id}
                  className={cn(
                    "max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-xl max-md:border max-md:p-4",
                    errors[r.id] && "bg-destructive/5",
                  )}
                >
                  <TableCell className="max-md:col-span-2 max-md:p-0 max-md:whitespace-normal">
                    <div className="flex items-center gap-2 font-medium">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: vizColor(r.assetClass.color) }}
                        aria-hidden
                      />
                      {r.name}
                    </div>
                    {r.trackUnits && r.units !== null ? (
                      <div className="text-xs text-muted-foreground">
                        {formatUnits(r.units)} units
                      </div>
                    ) : null}
                    {errors[r.id] ? (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {errors[r.id]}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right max-md:hidden">
                    <Money valueMinor={r.investedMinor} currency={r.currency} />
                  </TableCell>
                  <TableCell className="text-right max-md:p-0 max-md:text-left max-md:whitespace-normal">
                    <span className="block text-xs text-muted-foreground md:hidden">
                      Last value
                    </span>
                    <Money valueMinor={r.currentValueMinor} currency={r.currency} />
                  </TableCell>
                  <TableCell className="max-md:p-0 max-md:text-right max-md:whitespace-normal">
                    <span className="block text-xs text-muted-foreground md:hidden">Updated</span>
                    {r.stale ? (
                      <StaleBadge days={r.daysSinceValued} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.lastValuedAt ? day(r.lastValuedAt) : "Never"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-md:col-span-2 max-md:p-0 max-md:whitespace-normal">
                    {byPrice(r) ? (
                      <PriceInput
                        aria-label={`New price for ${r.name}`}
                        placeholder="NAV"
                        currency={r.currency}
                        value={entry(r.id).price}
                        onChange={(v) => update(r.id, { price: v })}
                      />
                    ) : (
                      <MoneyInput
                        aria-label={`New value for ${r.name}`}
                        currency={r.currency}
                        value={entry(r.id).value}
                        onChange={(v) => update(r.id, { value: v })}
                      />
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right max-md:col-span-2 max-md:p-0 max-md:whitespace-normal">
                    {delta !== null ? (
                      <div className="flex flex-col items-end gap-1 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:justify-between">
                        <Money valueMinor={delta} currency={r.currency} signed={delta > 0} />
                        {deltaBp !== null ? (
                          <span className="text-xs text-muted-foreground">
                            {formatPercentBp(deltaBp, { signed: true })}
                          </span>
                        ) : null}
                        {big ? (
                          <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={entry(r.id).confirm}
                              onCheckedChange={(c) => update(r.id, { confirm: c === true })}
                              aria-label={`Confirm big change for ${r.name}`}
                            />
                            Confirm
                          </label>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground max-md:hidden">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {/* Room for the pinned Save all bar on phones */}
      <div aria-hidden className="h-16 md:hidden" />
    </div>
  );
}
