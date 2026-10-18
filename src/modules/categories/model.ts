import { Schema, type Types } from "mongoose";
import { userScopedModel } from "@/server/db/model";

export const CATEGORY_KINDS = ["income", "expense"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

// docs/03-DATA-MODEL.md — categories (2 levels)
export interface CategoryDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  kind: CategoryKind;
  parentId: Types.ObjectId | null;
  icon: string | null;
  color: string | null;
  isEssential: boolean;
  isSystem: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: CATEGORY_KINDS, required: true },
    parentId: { type: Schema.Types.ObjectId, default: null },
    icon: { type: String, default: null },
    color: { type: String, default: null },
    isEssential: { type: Boolean, required: true, default: false },
    isSystem: { type: Boolean, required: true, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

categorySchema.index({ userId: 1, kind: 1, parentId: 1 });
// One copy of each system category per user, so concurrent seeding stays idempotent.
categorySchema.index(
  { userId: 1, kind: 1, name: 1 },
  { unique: true, partialFilterExpression: { isSystem: true }, name: "uniq_system_category" },
);

export const CategoryModel = userScopedModel<CategoryDoc>("Category", categorySchema, "categories");
