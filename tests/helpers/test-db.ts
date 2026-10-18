import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { connectDb, disconnectDb } from "@/server/db/connect";

export interface TestDb {
  /** Connection string of the in-memory replica set (for clients other than Mongoose). */
  uri(): string;
}

/**
 * Starts one in-memory replica set per test file (transactions need a replica set), connects the
 * app's Mongoose connection to it, clears every collection before each test, stops afterwards.
 */
export function setupTestDb(dbName = "wealthtrack-test"): TestDb {
  let replSet: MongoMemoryReplSet | undefined;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      // First launch on Windows can exceed the 10s default while Defender scans the binary
      instanceOpts: [{ launchTimeout: 60_000 }],
    });
    await connectDb(replSet.getUri(dbName));
    // Build declared indexes (e.g. unique userId) before tests rely on them.
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) return;
    for (const c of await db.collections()) await c.deleteMany({});
  });

  afterAll(async () => {
    await disconnectDb();
    await replSet?.stop();
  });

  return {
    uri: () => {
      if (!replSet) throw new Error("test DB not started");
      return replSet.getUri(dbName);
    },
  };
}
