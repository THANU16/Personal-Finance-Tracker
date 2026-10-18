import { Schema, type Types } from "mongoose";
import { ACCOUNT_TYPES, type AccountType } from "@/domain/accounts";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — snapshots (month-end cache of the net-worth series, docs/04 §16).
export interface SnapshotDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Business date (month-end for `auto`) at local midnight. */
  date: Date;
  kind: "auto" | "manual";
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  byClass: { assetClassId: Types.ObjectId; valueMinor: number }[];
  byAccountType: { type: AccountType; valueMinor: number }[];
  investedMinor: number;
  cashMinor: number;
  holdingsValueMinor: number;
  /** Items left out because an FX rate was missing on that date. */
  fxMissing: number;
  createdAt: Date;
  updatedAt: Date;
}

const snapshotSchema = new Schema<SnapshotDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },
    kind: { type: String, enum: ["auto", "manual"], required: true },
    netWorthMinor: intField({ required: true }),
    assetsMinor: intField({ required: true }),
    liabilitiesMinor: intField({ required: true }),
    byClass: [
      {
        _id: false,
        assetClassId: { type: Schema.Types.ObjectId, required: true },
        valueMinor: intField({ required: true }),
      },
    ],
    byAccountType: [
      {
        _id: false,
        type: { type: String, enum: ACCOUNT_TYPES, required: true },
        valueMinor: intField({ required: true }),
      },
    ],
    investedMinor: intField({ required: true, default: 0 }),
    cashMinor: intField({ required: true, default: 0 }),
    holdingsValueMinor: intField({ required: true, default: 0 }),
    fxMissing: intField({ required: true, default: 0, min: 0 }),
  },
  { timestamps: true },
);

snapshotSchema.index(
  { userId: 1, date: 1 },
  { unique: true, partialFilterExpression: { kind: "auto" }, name: "uniq_auto_snapshot" },
);
snapshotSchema.index({ userId: 1, kind: 1, date: -1 });

export const SnapshotModel = userScopedModel<SnapshotDoc>("Snapshot", snapshotSchema, "snapshots");
