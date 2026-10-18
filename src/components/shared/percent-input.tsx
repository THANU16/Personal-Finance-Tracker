"use client";

import { bpToPercentString, parsePercentToBp } from "@/domain/money";
import {
  ScaledNumberInput,
  type ScaledNumberInputProps,
} from "@/components/shared/scaled-number-input";

export type PercentInputProps = Omit<ScaledNumberInputProps, "parse" | "format" | "endAdornment">;

/** Percent input (up to 2 decimals); `value`/`onChange` are basis points (12.5% = 1250). */
export function PercentInput(props: PercentInputProps) {
  return (
    <ScaledNumberInput
      {...props}
      endAdornment="%"
      parse={parsePercentToBp}
      format={bpToPercentString}
    />
  );
}
