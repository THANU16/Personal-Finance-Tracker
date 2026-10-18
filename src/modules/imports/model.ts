import { Schema, type Types } from "mongoose";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03 + docs/07 §5 — import batches (draft → previewed → imported → reverted), staging rows and
// saved mappings reused for the next file.

export const IMPORT_SOURCES = ["money_manager", "bank_csv"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const BATCH_STATUSES = ["draft", "previewed", "imported", "reverted"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const ROW_KINDS = ["expense", "income", "transfer", "fee", "difference", "problem"] as const;

export interface ImportBatchDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  source: ImportSource;
  status: BatchStatus;
  files: { name: string; sheet: string; rows: number; from: string | null; to: string | null }[];
  /** Wizard state: ImportMapping + create specs + openings (validated by the service). */
  mapping: unknown;
  /** Rows dropped as cross-file duplicates (row ids) and other warnings. */
  warnings: string[];
  /** Filled by preview and commit. */
  summary: unknown;
  createdItems: {
    accountIds: Types.ObjectId[];
    categoryIds: Types.ObjectId[];
    holdingIds: Types.ObjectId[];
  };
  importedAt: Date | null;
  revertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const batchSchema = new Schema<ImportBatchDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    source: { type: String, enum: IMPORT_SOURCES, required: true },
    status: { type: String, enum: BATCH_STATUSES, required: true, default: "draft" },
    files: [
      {
        _id: false,
        name: { type: String, required: true },
        sheet: { type: String, required: true },
        rows: intField({ required: true, min: 0 }),
        from: { type: String, default: null },
        to: { type: String, default: null },
      },
    ],
    mapping: { type: Schema.Types.Mixed, default: null },
    warnings: { type: [String], default: [] },
    summary: { type: Schema.Types.Mixed, default: null },
    createdItems: {
      accountIds: { type: [Schema.Types.ObjectId], default: [] },
      categoryIds: { type: [Schema.Types.ObjectId], default: [] },
      holdingIds: { type: [Schema.Types.ObjectId], default: [] },
    },
    importedAt: { type: Date, default: null },
    revertedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
batchSchema.index({ userId: 1, createdAt: -1 });

export const ImportBatchModel = userScopedModel<ImportBatchDoc>(
  "ImportBatch",
  batchSchema,
  "importBatches",
);

export interface ImportRowDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  batchId: Types.ObjectId;
  /** Chronological position after merging files. */
  seq: number;
  rowId: string;
  kind: (typeof ROW_KINDS)[number];
  /** The normalised Money Manager row (MmRow). */
  normalized: unknown;
  hash: string;
  /** Duplicate of a row already in WealthTrack (re-import adds 0). */
  alreadyImported: boolean;
}

const rowSchema = new Schema<ImportRowDoc>({
  userId: { type: Schema.Types.ObjectId, required: true },
  batchId: { type: Schema.Types.ObjectId, required: true },
  seq: intField({ required: true, min: 0 }),
  rowId: { type: String, required: true },
  kind: { type: String, enum: ROW_KINDS, required: true },
  normalized: { type: Schema.Types.Mixed, required: true },
  hash: { type: String, required: true },
  alreadyImported: { type: Boolean, required: true, default: false },
});
rowSchema.index({ userId: 1, batchId: 1, seq: 1 });

export const ImportRowModel = userScopedModel<ImportRowDoc>("ImportRow", rowSchema, "importRows");

export const MAPPING_KINDS = ["account", "expense_category", "income_category"] as const;

export interface ImportMappingDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  source: ImportSource;
  kind: (typeof MAPPING_KINDS)[number];
  sourceKey: string;
  /** The saved AccountMapping / CategoryMapping, with created items replaced by their ids. */
  action: unknown;
  updatedAt: Date;
}

const mappingSchema = new Schema<ImportMappingDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    source: { type: String, enum: IMPORT_SOURCES, required: true },
    kind: { type: String, enum: MAPPING_KINDS, required: true },
    sourceKey: { type: String, required: true },
    action: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);
mappingSchema.index({ userId: 1, source: 1, kind: 1, sourceKey: 1 }, { unique: true });

export const ImportMappingModel = userScopedModel<ImportMappingDoc>(
  "ImportMapping",
  mappingSchema,
  "importMappings",
);
