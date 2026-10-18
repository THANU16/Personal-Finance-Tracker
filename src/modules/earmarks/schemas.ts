import { z } from "zod";
import {
  BUCKETS,
  BUCKET_SLOTS,
  type Bucket,
  type EarmarkMode,
  type EffectiveEarmarks,
} from "@/domain/earmarks";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
const positiveMinor = z
  .number()
  .int("Must be a whole amount")
  .min(1, "Enter an amount above zero")
  .max(Number.MAX_SAFE_INTEGER);

export const setEarmarkSchema = z.discriminatedUnion("mode", [
  z
    .object({
      accountId: objectId,
      bucket: z.enum(BUCKETS),
      mode: z.literal("fixed"),
      amountMinor: positiveMinor,
      note: z.string().trim().max(200).nullish(),
    })
    .strict(),
  z
    .object({
      accountId: objectId,
      bucket: z.enum(BUCKETS),
      mode: z.literal("percent"),
      percentBp: z
        .number()
        .int("Use whole basis points")
        .min(1, "Enter a percentage above zero")
        .max(10_000, "At most 100%"),
      note: z.string().trim().max(200).nullish(),
    })
    .strict(),
]);
export type SetEarmarkInput = z.input<typeof setEarmarkSchema>;

export const removeEarmarkSchema = z
  .object({ accountId: objectId, bucket: z.enum(BUCKETS) })
  .strict();

export const moveBetweenBucketsSchema = z
  .object({
    accountId: objectId,
    from: z.enum(BUCKET_SLOTS),
    to: z.enum(BUCKET_SLOTS),
    amountMinor: positiveMinor,
  })
  .strict()
  .refine((v) => v.from !== v.to, { path: ["to"], message: "Choose a different bucket" });
export type MoveBetweenBucketsInput = z.input<typeof moveBetweenBucketsSchema>;

export interface EarmarkDTO {
  id: string;
  accountId: string;
  bucket: Bucket;
  mode: EarmarkMode;
  amountMinor: number | null;
  percentBp: number | null;
  note: string | null;
  /** Raw amount on the current balance (before any over-earmark reduction). */
  rawMinor: number;
}

/** Buckets of one account. Dedicated accounts are one whole bucket and carry no earmarks. */
export interface AccountBucketsDTO extends EffectiveEarmarks {
  accountId: string;
  currency: string;
  balanceMinor: number;
  earmarkable: boolean;
  archived: boolean;
  /** Can carry earmarks by type (even if its balance is 0 right now). */
  canCarryEarmarks: boolean;
  dedicated: Bucket | null;
  earmarks: EarmarkDTO[];
}

/** Totals per currency (FX conversion to base arrives in Phase 4). */
export interface BucketTotalsDTO {
  currency: string;
  emergencyMinor: number;
  opportunityMinor: number;
  freeMinor: number;
}
