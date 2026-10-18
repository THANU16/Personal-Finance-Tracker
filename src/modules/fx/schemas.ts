import { z } from "zod";
import { isDateKey } from "@/domain/dates";
import { minorUnitDigits } from "@/domain/money";

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
  .refine((c) => {
    try {
      minorUnitDigits(c);
      return true;
    } catch {
      return false;
    }
  }, "Unknown currency");

export const fxRateInputSchema = z
  .object({
    date: z.string().refine(isDateKey, "Enter a valid date"),
    base: currency,
    quote: currency,
    rate: z
      .number()
      .positive("Enter a rate above zero")
      .max(1e9, "That rate is too large")
      .refine((r) => Number.isFinite(r), "Enter a number"),
  })
  .strict()
  .refine((v) => v.base !== v.quote, {
    path: ["quote"],
    message: "Choose two different currencies",
  });
export type FxRateInput = z.input<typeof fxRateInputSchema>;

export interface FxRateDTO {
  id: string;
  date: string;
  base: string;
  quote: string;
  rate: number;
}
