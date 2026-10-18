import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface MoneyProps {
  valueMinor: number;
  currency: string;
  /** `LKR 1.25M` with the full amount in a tooltip (cards). */
  compact?: boolean;
  /** Prefix positives with `+` (gains, changes). */
  signed?: boolean;
  /** Negative amounts in red (default true). */
  colorNegative?: boolean;
  locale?: string;
  className?: string;
}

/**
 * The only way to render money. Blurs while "hide amounts" is on (`[data-hide-amounts]` on <html>).
 */
export function Money({
  valueMinor,
  currency,
  compact = false,
  signed = false,
  colorNegative = true,
  locale,
  className,
}: MoneyProps) {
  const full = formatMoney(valueMinor, currency, { signed, locale });
  const text = compact
    ? formatMoney(valueMinor, currency, { signed, locale, compact: true })
    : full;
  const span = (
    <span
      data-money=""
      className={cn(
        "whitespace-nowrap tabular-nums",
        colorNegative && valueMinor < 0 && "text-destructive",
        className,
      )}
    >
      {text}
    </span>
  );
  if (!compact || text === full) return span;
  return (
    <Tooltip>
      <TooltipTrigger render={span} />
      <TooltipContent>
        <span data-money="">{full}</span>
      </TooltipContent>
    </Tooltip>
  );
}
