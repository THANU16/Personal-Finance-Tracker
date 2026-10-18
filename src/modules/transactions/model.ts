import { Schema, type Types } from "mongoose";
import {
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type TransactionStatus,
  type TransactionType,
} from "@/domain/ledger";
import { intField, userScopedModel } from "@/server/db/model";

export const SOURCE_KINDS = [
  "manual",
  "sip_execution",
  "recurring",
  "opportunity_deployment",
  "import",
  "reconcile",
  "fd_maturity",
  "system",
  /** Asset → asset transfer: a redeem and an invest sharing a groupId, voided together. */
  "switch",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Transactions created by these owners are changed only through the owner (docs/04 §18). */
export const OWNER_MANAGED_SOURCES: readonly SourceKind[] = [
  "sip_execution",
  "opportunity_deployment",
];

export const INCOME_KINDS = ["dividend", "interest", "distribution", "rent", "other"] as const;

// docs/03-DATA-MODEL.md — transactions. Written only by src/server/ledger.
export interface TransactionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: TransactionType;
  date: Date;
  amountMinor: number;
  currency: string;
  fromAccountId: Types.ObjectId | null;
  toAccountId: Types.ObjectId | null;
  toAmountMinor: number | null;
  fxRate: number | null;
  categoryId: Types.ObjectId | null;
  splits: { categoryId: Types.ObjectId; amountMinor: number; note: string | null }[];
  holdingId: Types.ObjectId | null;
  units: number | null;
  /** Price per unit in minor units × 10⁴ (NAV to 4 extra decimals). */
  priceMinorE4: number | null;
  feeMinor: number;
  taxMinor: number;
  incomeKind: (typeof INCOME_KINDS)[number] | null;
  reinvest: boolean | null;
  redemption: {
    costRemovedMinor: number;
    realizedGainMinor: number;
    unitsRemoved: number | null;
  } | null;
  debtId: Types.ObjectId | null;
  principalMinor: number | null;
  interestMinor: number | null;
  description: string | null;
  counterparty: string | null;
  notes: string | null;
  tags: string[];
  attachmentIds: Types.ObjectId[];
  source: { kind: SourceKind; refId: Types.ObjectId | null };
  groupId: Types.ObjectId | null;
  status: TransactionStatus;
  voidedAt: Date | null;
  voidReason: string | null;
  replacedById: Types.ObjectId | null;
  importHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<TransactionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    date: { type: Date, required: true },
    amountMinor: intField({ required: true, min: 1 }),
    currency: { type: String, required: true },
    fromAccountId: { type: Schema.Types.ObjectId, default: null },
    toAccountId: { type: Schema.Types.ObjectId, default: null },
    toAmountMinor: intField({ default: null, min: 1 }),
    fxRate: { type: Number, default: null },
    categoryId: { type: Schema.Types.ObjectId, default: null },
    splits: {
      type: [
        new Schema(
          {
            categoryId: { type: Schema.Types.ObjectId, required: true },
            amountMinor: intField({ required: true, min: 1 }),
            note: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    holdingId: { type: Schema.Types.ObjectId, default: null },
    units: { type: Number, default: null },
    priceMinorE4: intField({ default: null, min: 0 }),
    feeMinor: intField({ required: true, default: 0, min: 0 }),
    taxMinor: intField({ required: true, default: 0, min: 0 }),
    incomeKind: { type: String, enum: [...INCOME_KINDS, null], default: null },
    reinvest: { type: Boolean, default: null },
    redemption: {
      type: new Schema(
        {
          costRemovedMinor: intField({ required: true }),
          realizedGainMinor: intField({ required: true }),
          unitsRemoved: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    debtId: { type: Schema.Types.ObjectId, default: null },
    principalMinor: intField({ default: null, min: 0 }),
    interestMinor: intField({ default: null, min: 0 }),
    description: { type: String, default: null, trim: true },
    counterparty: { type: String, default: null, trim: true },
    notes: { type: String, default: null },
    tags: { type: [String], default: [] },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    source: {
      kind: { type: String, enum: SOURCE_KINDS, required: true, default: "manual" },
      refId: { type: Schema.Types.ObjectId, default: null },
    },
    groupId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: TRANSACTION_STATUSES, required: true, default: "posted" },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null },
    replacedById: { type: Schema.Types.ObjectId, default: null },
    importHash: { type: String },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, fromAccountId: 1, date: 1 });
transactionSchema.index({ userId: 1, toAccountId: 1, date: 1 });
transactionSchema.index({ userId: 1, holdingId: 1, date: 1 });
transactionSchema.index({ userId: 1, categoryId: 1, date: 1 });
transactionSchema.index({ userId: 1, groupId: 1 });
// docs/03 says "unique sparse", but a compound sparse index still indexes every doc that has
// userId (all of them) and collides on importHash: null. A partial index gives the intended
// behaviour: unique only among imported rows.
transactionSchema.index(
  { userId: 1, importHash: 1 },
  {
    unique: true,
    partialFilterExpression: { importHash: { $type: "string" } },
    name: "uniq_import_hash",
  },
);
transactionSchema.index({ description: "text", notes: "text" });

export const TransactionModel = userScopedModel<TransactionDoc>(
  "Transaction",
  transactionSchema,
  "transactions",
);
