"use client";

import { minorToDecimalString, parseMoneyToMinor } from "@/domain/money";
import {
  ScaledNumberInput,
  type ScaledNumberInputProps,
} from "@/components/shared/scaled-number-input";

export interface MoneyInputProps extends Omit<
  ScaledNumberInputProps,
  "parse" | "format" | "startAdornment"
> {
  currency: string;
}

/** Decimal money input; `value`/`onChange` are integer minor units (null when empty). */
export function MoneyInput({ currency, ...props }: MoneyInputProps) {
  return (
    <ScaledNumberInput
      {...props}
      startAdornment={currency}
      parse={(text) => parseMoneyToMinor(text, currency)}
      format={(minor) => minorToDecimalString(minor, currency)}
    />
  );
}
