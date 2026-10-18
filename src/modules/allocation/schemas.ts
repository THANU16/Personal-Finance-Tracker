import { z } from "zod";
import type { AllocationTree } from "@/domain/allocation";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const bp = z.number().int("Use whole basis points").min(0).max(10_000);

export const allocationTreeInputSchema = z
  .array(
    z
      .object({
        assetClassId: objectId,
        percentBp: bp,
        assets: z
          .array(z.object({ holdingId: objectId, percentBp: bp }).strict())
          .max(50)
          .default([]),
      })
      .strict(),
  )
  .max(30);

export const saveTargetSchema = z
  .object({
    allocation: allocationTreeInputSchema,
    thresholdBp: z.number().int().min(50, "At least 0.5%").max(5_000, "At most 50%"),
    note: z.string().trim().max(200).nullish(),
  })
  .strict();
export type SaveTargetInput = z.input<typeof saveTargetSchema>;

export interface TargetDTO {
  allocation: AllocationTree;
  thresholdBp: number;
  updatedAt: string | null;
}

export interface TargetHistoryDTO {
  id: string;
  savedAt: string;
  thresholdBp: number;
  allocation: AllocationTree;
  note: string | null;
}

/** What the tree editor needs to show names, colours and pick holdings. */
export interface TreeOptions {
  classes: { id: string; name: string; color: string }[];
  holdings: { id: string; name: string; assetClassId: string; currency: string; active: boolean }[];
}
