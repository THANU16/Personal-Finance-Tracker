import { z } from "zod";
import { CATEGORY_KINDS, type CategoryKind } from "@/modules/categories/model";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
const name = z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters");
const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #3b82f6")
  .nullable();

export const createCategorySchema = z
  .object({
    name,
    kind: z.enum(CATEGORY_KINDS),
    parentId: objectId.nullable().default(null),
    isEssential: z.boolean().default(false),
    icon: z.string().max(40).nullable().default(null),
    color: color.default(null),
  })
  .strict();
export type CreateCategoryInput = z.input<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name,
    parentId: objectId.nullable(),
    isEssential: z.boolean(),
    icon: z.string().max(40).nullable(),
    color,
  })
  .partial()
  .strict();
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

export interface CategoryDTO {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isEssential: boolean;
  isSystem: boolean;
  archived: boolean;
}

export interface CategoryNode extends CategoryDTO {
  children: CategoryDTO[];
}
