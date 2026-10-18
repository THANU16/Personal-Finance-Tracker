import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — assetClasses
export interface AssetClassDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const assetClassSchema = new Schema<AssetClassDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true },
    sortOrder: intField({ required: true, default: 0 }),
    isSystem: { type: Boolean, required: true, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

assetClassSchema.index({ userId: 1, sortOrder: 1 });
assetClassSchema.index(
  { userId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isSystem: true }, name: "uniq_system_asset_class" },
);

export const AssetClassModel = userScopedModel<AssetClassDoc>(
  "AssetClass",
  assetClassSchema,
  "assetClasses",
);
