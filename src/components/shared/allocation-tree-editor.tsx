"use client";

import { ChevronDown, ChevronRight, Plus, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Money } from "@/components/shared/money";
import { PercentInput } from "@/components/shared/percent-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  autoBalance,
  splitByTree,
  validateTree,
  type AllocationClass,
  type AllocationTree,
} from "@/domain/allocation";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { vizColor } from "@/lib/viz-palette";
import type { TreeOptions } from "@/modules/allocation/schemas";

/**
 * docs/05 §6 — two-level allocation editor (target, SIP custom trees, opportunity fund).
 * Class rows: % input + slider + live amount; expandable holdings: % of class, % of total, amount.
 * Changing a class % keeps its holdings' % (amounts rescale). Totals bar is red unless 100%.
 */
export function AllocationTreeEditor({
  value,
  onChange,
  options,
  totalMinor,
  currency,
  requireAssets = false,
  holdingCurrency,
}: {
  value: AllocationTree;
  onChange: (tree: AllocationTree) => void;
  options: TreeOptions;
  /** Amount being split (live amounts); omit for the target. */
  totalMinor?: number | null;
  currency?: string;
  /** SIP custom trees must name holdings in every class. */
  requireAssets?: boolean;
  /** Only offer holdings in this currency (SIP invests from one account). */
  holdingCurrency?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const classById = new Map(options.classes.map((c) => [c.id, c]));
  const holdingById = new Map(options.holdings.map((h) => [h.id, h]));
  const sum = value.reduce((s, c) => s + c.percentBp, 0);
  const validation = useMemo(
    () =>
      validateTree(
        value,
        options.holdings.map((h) => ({ id: h.id, assetClassId: h.assetClassId, active: h.active })),
        { requireAssets },
      ),
    [value, options.holdings, requireAssets],
  );
  const amounts = useMemo(() => {
    if (!totalMinor || totalMinor <= 0 || sum !== 10_000 || validation.errors.length) return null;
    try {
      return splitByTree(totalMinor, value);
    } catch {
      return null;
    }
  }, [totalMinor, sum, validation.errors.length, value]);
  const amountOf = (classId: string, holdingId: string | null) =>
    amounts
      ?.filter(
        (l) => l.assetClassId === classId && (holdingId === null || l.holdingId === holdingId),
      )
      .reduce((s, l) => s + l.amountMinor, 0) ?? null;

  const update = (i: number, next: Partial<AllocationClass>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...next } : c)));
  const unusedClasses = options.classes.filter((c) => !value.some((v) => v.assetClassId === c.id));
  const errorsFor = (path: string) =>
    validation.errors.filter((e) => e.path === path).map((e) => e.message);

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2" aria-label="Allocation by asset class">
        {value.map((c, i) => {
          const cls = classById.get(c.assetClassId);
          const expanded = open[c.assetClassId] ?? true;
          const assetSum = c.assets.reduce((s, a) => s + a.percentBp, 0);
          const holdingsForClass = options.holdings.filter(
            (h) =>
              h.assetClassId === c.assetClassId &&
              h.active &&
              (!holdingCurrency || h.currency === holdingCurrency) &&
              !c.assets.some((a) => a.holdingId === h.id),
          );
          const classErrors = errorsFor(`class:${c.assetClassId}`);
          return (
            <li key={c.assetClassId} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <button
                  type="button"
                  className="flex min-w-36 flex-1 items-center gap-2 text-left font-medium"
                  aria-expanded={expanded}
                  onClick={() => setOpen((o) => ({ ...o, [c.assetClassId]: !expanded }))}
                >
                  {expanded ? (
                    <ChevronDown className="size-4" aria-hidden />
                  ) : (
                    <ChevronRight className="size-4" aria-hidden />
                  )}
                  <span
                    className="size-3 rounded-sm"
                    style={{ background: vizColor(cls?.color ?? "#6250d6") }}
                    aria-hidden
                  />
                  {cls?.name ?? "Asset class"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={10_000}
                  step={50}
                  value={c.percentBp}
                  onChange={(e) => update(i, { percentBp: Number(e.target.value) })}
                  aria-label={`${cls?.name ?? "Class"} share`}
                  className="w-32 accent-[var(--viz-series-1)]"
                />
                <PercentInput
                  aria-label={`${cls?.name ?? "Class"} percent`}
                  className="w-24"
                  value={c.percentBp}
                  onChange={(v) => update(i, { percentBp: v ?? 0 })}
                />
                {totalMinor ? (
                  <span className="w-32 text-right text-sm tabular-nums">
                    {amountOf(c.assetClassId, null) !== null ? (
                      <Money
                        valueMinor={amountOf(c.assetClassId, null)!}
                        currency={currency ?? "LKR"}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${cls?.name ?? "class"}`}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {classErrors.length ? (
                <p role="alert" className="px-3 pb-2 text-xs text-destructive">
                  {classErrors[0]}
                </p>
              ) : null}
              {expanded ? (
                <div className="grid gap-2 border-t bg-muted/30 p-3">
                  {c.assets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {requireAssets
                        ? "Add the holdings this class buys."
                        : "No holdings yet — a SIP will ask which holding to buy for this class."}
                    </p>
                  ) : null}
                  {c.assets.map((a, k) => {
                    const h = holdingById.get(a.holdingId);
                    const ofTotal = Math.round((c.percentBp * a.percentBp) / 10_000);
                    return (
                      <div
                        key={a.holdingId}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                      >
                        <span
                          className={cn(
                            "min-w-36 flex-1 truncate",
                            !h?.active && "text-destructive",
                          )}
                        >
                          {h?.name ?? "Unknown holding"}
                          {h && !h.active ? " (closed)" : ""}
                        </span>
                        <PercentInput
                          aria-label={`${h?.name ?? "Holding"} percent of class`}
                          className="w-24"
                          value={a.percentBp}
                          onChange={(v) =>
                            update(i, {
                              assets: c.assets.map((x, m) =>
                                m === k ? { ...x, percentBp: v ?? 0 } : x,
                              ),
                            })
                          }
                        />
                        <span className="w-24 text-xs text-muted-foreground tabular-nums">
                          {formatPercentBp(ofTotal)} of total
                        </span>
                        {totalMinor ? (
                          <span className="w-32 text-right tabular-nums">
                            {amountOf(c.assetClassId, a.holdingId) !== null ? (
                              <Money
                                valueMinor={amountOf(c.assetClassId, a.holdingId)!}
                                currency={currency ?? "LKR"}
                              />
                            ) : (
                              "—"
                            )}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${h?.name ?? "holding"}`}
                          onClick={() => update(i, { assets: c.assets.filter((_, m) => m !== k) })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap items-center gap-2">
                    {holdingsForClass.length ? (
                      <Select
                        value=""
                        onValueChange={(id) => {
                          if (!id) return;
                          const assets = [...c.assets, { holdingId: id, percentBp: 0 }];
                          update(i, { assets: autoBalance(assets) });
                        }}
                        items={holdingsForClass.map((h) => ({ value: h.id, label: h.name }))}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Add a holding to ${cls?.name ?? "class"}`}
                          className="w-56"
                        >
                          <Plus className="size-3.5" aria-hidden />
                          <SelectValue placeholder="Add holding" />
                        </SelectTrigger>
                        <SelectContent>
                          {holdingsForClass.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No more holdings in this class
                        {holdingCurrency ? ` (${holdingCurrency})` : ""}.
                      </span>
                    )}
                    {c.assets.length > 1 && assetSum !== 10_000 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => update(i, { assets: autoBalance(c.assets) })}
                      >
                        <Scale aria-hidden /> Balance holdings
                      </Button>
                    ) : null}
                    {c.assets.length ? (
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          assetSum === 10_000 ? "text-muted-foreground" : "text-destructive",
                        )}
                      >
                        Holdings total {formatPercentBp(assetSum)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {unusedClasses.length ? (
          <Select
            value=""
            onValueChange={(id) =>
              id &&
              onChange([
                ...value,
                { assetClassId: id, percentBp: Math.max(0, 10_000 - sum), assets: [] },
              ])
            }
            items={unusedClasses.map((c) => ({ value: c.id, label: c.name }))}
          >
            <SelectTrigger size="sm" aria-label="Add an asset class" className="w-56">
              <Plus className="size-3.5" aria-hidden />
              <SelectValue placeholder="Add asset class" />
            </SelectTrigger>
            <SelectContent>
              {unusedClasses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {value.length > 0 && sum !== 10_000 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange(autoBalance(value))}
          >
            <Scale aria-hidden /> Auto-balance
          </Button>
        ) : null}
      </div>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium",
          sum === 10_000 ? "bg-muted" : "bg-destructive/10 text-destructive",
        )}
      >
        <span>Total</span>
        <span className="tabular-nums">
          {formatPercentBp(sum)}
          {sum !== 10_000 ? ` — must be 100%` : ""}
        </span>
      </div>
      {validation.warnings.length ? (
        <p className="text-xs text-muted-foreground">
          {validation.warnings.map((w) => w.message).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export function treeIsValid(
  tree: AllocationTree,
  options: TreeOptions,
  requireAssets = false,
): boolean {
  return (
    validateTree(
      tree,
      options.holdings.map((h) => ({ id: h.id, assetClassId: h.assetClassId, active: h.active })),
      { requireAssets },
    ).errors.length === 0
  );
}
