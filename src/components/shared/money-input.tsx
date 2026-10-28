"use client";

import { minorToDecimalString, parseMoneyToMinor } from "@/domain/money";
import {
  ScaledNumberInput,
  type ScaledNumberInputProps,
} from "@/components/shared/scaled-number-input";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export interface MoneyInputProps extends Omit<
  ScaledNumberInputProps,
  "parse" | "format" | "startAdornment" | "groupWhileTyping" | "adornmentClassName" | "size"
> {
  currency: string;
  /** "lg": the big amount-first field (Quick add, docs/07 §5). */
  size?: "default" | "lg";
}

/**
 * Decimal money input; `value`/`onChange` are integer minor units (null when empty).
 * On phones it shows thousands separators while typing (docs/07 §4); desktop is unchanged.
 */
export function MoneyInput({ currency, size = "default", className, ...props }: MoneyInputProps) {
  const isMobile = useIsMobile();
  const lg = size === "lg";
  return (
    <ScaledNumberInput
      {...props}
      className={cn(lg && "h-16 pl-16 text-3xl font-semibold md:h-14 md:text-2xl", className)}
      adornmentClassName={lg ? "text-base" : undefined}
      groupWhileTyping={isMobile}
      startAdornment={currency}
      parse={(text) => parseMoneyToMinor(text, currency)}
      format={(minor) => minorToDecimalString(minor, currency)}
    />
  );
}
