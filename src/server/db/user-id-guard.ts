import type { Aggregate, Query, Schema } from "mongoose";

/**
 * Mongoose plugin: in development and test, any query on a user-owned collection whose filter does
 * not include `userId` throws. Opt out for deliberate cross-user jobs (cron) with
 * `.setOptions({ skipUserIdGuard: true })` or `aggregate(...).option({ skipUserIdGuard: true })`.
 */
export class UnscopedQueryError extends Error {
  constructor(model: string, op: string) {
    super(`${model}.${op}() without a userId filter. Scope every query by ctx.userId.`);
    this.name = "UnscopedQueryError";
  }
}

const QUERY_OPS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "countDocuments",
  "distinct",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
] as const;

type Filter = Record<string, unknown>;

function hasUserId(filter: Filter | undefined): boolean {
  if (!filter) return false;
  if (filter.userId !== undefined && filter.userId !== null) return true;
  const and = filter.$and;
  return Array.isArray(and) && and.some((f) => hasUserId(f as Filter));
}

export function isUserIdGuardEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function userIdGuardPlugin(schema: Schema): void {
  if (!isUserIdGuardEnabled()) return;

  for (const op of QUERY_OPS) {
    schema.pre(op, function (this: Query<unknown, unknown>) {
      if (this.getOptions().skipUserIdGuard) return;
      if (!hasUserId(this.getFilter())) throw new UnscopedQueryError(this.model.modelName, op);
    });
  }

  schema.pre("aggregate", function (this: Aggregate<unknown>) {
    if (this.options.skipUserIdGuard) return;
    const first = this.pipeline()[0] as { $match?: Filter } | undefined;
    if (!hasUserId(first?.$match)) {
      throw new UnscopedQueryError(
        this.model().modelName,
        "aggregate (first stage must $match userId)",
      );
    }
  });
}
