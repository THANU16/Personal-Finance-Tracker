import mongoose, { type Model, type Schema } from "mongoose";
import { userIdGuardPlugin } from "@/server/db/user-id-guard";

/**
 * Registers a model for a user-owned collection with the userId guard. When a module is evaluated
 * again (dev hot reload after a schema change) the model is recompiled from the NEW schema: reusing
 * the cached one kept stale schemas alive, and Mongoose then silently dropped new fields from
 * queries and updates (this re-ran first-login setup on every request and duplicated categories).
 */
export function userScopedModel<T>(name: string, schema: Schema<T>, collection: string): Model<T> {
  if (mongoose.models[name]) mongoose.deleteModel(name);
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
