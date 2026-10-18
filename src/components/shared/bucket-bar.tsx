import { Money } from "@/components/shared/money";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Emergency / Opportunity / Free split of an account (docs/04 §20). Colours are the validated
 * series slots 1/2 (light + dark) with neutral grey for free cash; the legend names every
 * segment, so identity never depends on colour alone.
 */
const SEGMENTS = [
  { key: "emergencyMinor", label: "Emergency", swatch: "bg-[var(--viz-series-1)]" },
  { key: "opportunityMinor", label: "Opportunity", swatch: "bg-[var(--viz-series-2)]" },
  { key: "freeMinor", label: "Free", swatch: "bg-muted-foreground/35" },
] as const;

export interface BucketBarProps {
  emergencyMinor: number;
  opportunityMinor: number;
  freeMinor: number;
  currency: string;
  /** Hide the legend amounts (rows where space is tight). */
  compact?: boolean;
  className?: string;
}

export function BucketBar({ currency, compact = false, className, ...values }: BucketBarProps) {
  const parts = SEGMENTS.map((s) => ({ ...s, value: Math.max(0, values[s.key]) }));
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const summary = parts.map((p) => `${p.label} ${formatMoney(p.value, currency)}`).join(", ");

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div
        role="img"
        aria-label={summary}
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {total > 0
          ? parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <div
                  key={p.key}
                  className={cn("h-full first:rounded-l-full last:rounded-r-full", p.swatch)}
                  style={{ width: `${(p.value / total) * 100}%` }}
                />
              ))
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-sm", p.swatch)} />
            <span>{p.label}</span>
            {compact ? null : (
              <Money valueMinor={p.value} currency={currency} className="text-foreground" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
