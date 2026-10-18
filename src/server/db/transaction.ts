import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { connectDb } from "@/server/db/connect";

/**
 * Runs `fn` in a MongoDB transaction (retried on transient errors). Every query inside must pass
 * `{ session }`. Throwing aborts and rolls back all writes.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectDb();
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
