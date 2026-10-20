// JSON backup format (Phase 11). Pure: envelope checks and id remapping. The service serialises
// with EJSON (ObjectIds and dates survive) and supplies the id helpers.

export const BACKUP_FORMAT = "wealthtrack-backup";
export const BACKUP_VERSION = 1;

export interface BackupEnvelope<Doc = Record<string, unknown>> {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  baseCurrency: string;
  /** Collection name → documents. */
  collections: Record<string, Doc[]>;
}

export type EnvelopeCheck = { ok: true; envelope: BackupEnvelope } | { ok: false; message: string };

/** Validates the outer shape and version (documents are validated by the models on insert). */
export function checkEnvelope(value: unknown, known: readonly string[]): EnvelopeCheck {
  if (typeof value !== "object" || value === null)
    return { ok: false, message: "Not a backup file" };
  const v = value as Partial<BackupEnvelope>;
  if (v.format !== BACKUP_FORMAT) return { ok: false, message: "Not a WealthTrack backup file" };
  if (typeof v.version !== "number" || v.version > BACKUP_VERSION) {
    return {
      ok: false,
      message: `Backup version ${String(v.version)} is newer than this app supports`,
    };
  }
  if (typeof v.collections !== "object" || v.collections === null) {
    return { ok: false, message: "The backup has no collections" };
  }
  for (const [name, docs] of Object.entries(v.collections)) {
    if (!known.includes(name))
      return { ok: false, message: `Unknown collection "${name}" in the backup` };
    if (!Array.isArray(docs)) return { ok: false, message: `Collection "${name}" is not a list` };
  }
  return { ok: true, envelope: v as BackupEnvelope };
}

export interface IdOps<Id> {
  isId: (v: unknown) => v is Id;
  keyOf: (id: Id) => string;
  fresh: () => Id;
}

/**
 * Gives every document a fresh `_id` and rewrites every reference to a backed-up document (any
 * field, at any depth, in arrays too); `userId` values become `targetUserId`. References to ids
 * that are not in the backup are kept. Returns new objects; the input is not changed.
 */
export function remapIds<Id>(
  collections: Record<string, Record<string, unknown>[]>,
  targetUserId: Id,
  ops: IdOps<Id>,
): Record<string, Record<string, unknown>[]> {
  const map = new Map<string, Id>();
  for (const docs of Object.values(collections)) {
    for (const d of docs) {
      if (ops.isId(d._id)) map.set(ops.keyOf(d._id), ops.fresh());
    }
  }
  const walk = (v: unknown, key: string | null): unknown => {
    if (key === "userId" && ops.isId(v)) return targetUserId;
    if (ops.isId(v)) return map.get(ops.keyOf(v)) ?? v;
    if (Array.isArray(v)) return v.map((x) => walk(x, null));
    if (v instanceof Date) return v;
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return Object.fromEntries(
    Object.entries(collections).map(([name, docs]) => [
      name,
      docs.map((d) => walk(d, null) as Record<string, unknown>),
    ]),
  );
}
