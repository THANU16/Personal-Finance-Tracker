import { z } from "zod";

const name = z.string().trim().min(1, "Enter a name").max(40, "Use at most 40 characters");
const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #2563eb");

export const createAssetClassSchema = z
  .object({ name, color, sortOrder: z.number().int().min(0).max(1000).optional() })
  .strict();

export const updateAssetClassSchema = z
  .object({ name, color, sortOrder: z.number().int().min(0).max(1000) })
  .partial()
  .strict();

export interface AssetClassDTO {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  archived: boolean;
}
