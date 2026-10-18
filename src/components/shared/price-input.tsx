"use client";

import { parseScaledDecimal, priceDigits, scaledToDecimalString } from "@/domain/money";
import {
  ScaledNumberInput,
  type ScaledNumberInputProps,
} from "@/components/shared/scaled-number-input";

export interface PriceInputProps extends Omit<
  ScaledNumberInputProps,
  "parse" | "format" | "startAdornment"
> {
  currency: string;
}

/** Price/NAV per unit with 4 decimals beyond the currency; value is minor units × 10⁴. */
export function PriceInput({ currency, ...props }: PriceInputProps) {
  const digits = priceDigits(currency);
  return (
    <ScaledNumberInput
      {...props}
      startAdornment={currency}
      parse={(text) => parseScaledDecimal(text, digits)}
      format={(v) => scaledToDecimalString(v, digits).replace(/0{1,4}$/, "")}
    />
  );
}

const UNIT_DIGITS = 6;

/** Units (up to 6 decimals). Value is a plain number. */
export function UnitsInput(
  props: Omit<ScaledNumberInputProps, "parse" | "format" | "endAdornment">,
) {
  return (
    <ScaledNumberInput
      {...props}
      endAdornment="units"
      className="pr-14"
      parse={(text) => {
        const scaled = parseScaledDecimal(text, UNIT_DIGITS);
        return scaled === null ? null : scaled / 10 ** UNIT_DIGITS;
      }}
      format={(v) => String(Number(v.toFixed(UNIT_DIGITS)))}
    />
  );
}
