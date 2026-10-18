import "server-only";
import mongoose from "mongoose";
import { getEnv } from "@/server/env";

mongoose.set("strictQuery", true);

type ConnectionCache = { promise?: Promise<typeof mongoose> };

// Survive dev hot reloads without opening a new pool each time.
const globalCache = globalThis as typeof globalThis & { __wealthtrackMongoose?: ConnectionCache };
const cache = (globalCache.__wealthtrackMongoose ??= {});

/** Connects the shared Mongoose connection once. Tests pass an in-memory URI. */
export async function connectDb(uri?: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  cache.promise ??= mongoose.connect(uri ?? getEnv().MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    return await cache.promise;
  } catch (err) {
    cache.promise = undefined;
    throw err;
  }
}

export async function disconnectDb(): Promise<void> {
  cache.promise = undefined;
  await mongoose.disconnect();
}
