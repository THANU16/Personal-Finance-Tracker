import mongoose, { type Model, type Schema } from "mongoose";
import { userIdGuardPlugin } from "@/server/db/user-id-guard";

/**
 * Registers a model for a user-owned collection: applies the userId guard and reuses an existing
 * model on dev hot reload instead of recompiling.
 */
export function userScopedModel<T>(name: string, schema: Schema<T>, collection: string): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  if (existing) return existing;
  schema.plugin(userIdGuardPlugin);
  return mongoose.model<T>(name, schema, collection);
}

/** Schema type for integer money / basis-point fields. */
export function intField(
  opts: { required?: boolean; default?: number | null; min?: number; max?: number } = {},
) {
  return {
    type: Number,
    validate: {
      validator: (v: number | null | undefined) =>
        v === null || v === undefined || Number.isSafeInteger(v),
      message: "{PATH} must be an integer",
    },
    ...opts,
  };
}
