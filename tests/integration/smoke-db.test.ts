import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Phase 0 smoke test: the in-memory replica set starts on this machine and supports transactions.
// Phase 1 replaces this with the shared tests/helpers/test-db.ts helper.
describe("in-memory MongoDB replica set", () => {
  let replSet: MongoMemoryReplSet;
  let conn: mongoose.Connection;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      // First launch on Windows can exceed the 10s default while Defender scans the binary
      instanceOpts: [{ launchTimeout: 60_000 }],
    });
    conn = await mongoose.createConnection(replSet.getUri("wealthtrack-test")).asPromise();
  });

  afterAll(async () => {
    await conn?.close();
    await replSet?.stop();
  });

  it("commits a multi-document transaction", async () => {
    const items = conn.collection("smoke");
    await conn.transaction(async (session) => {
      await items.insertOne({ n: 1 }, { session });
      await items.insertOne({ n: 2 }, { session });
    });
    expect(await items.countDocuments()).toBe(2);
  });

  it("rolls back every write when the transaction throws", async () => {
    const items = conn.collection("rollback");
    await expect(
      conn.transaction(async (session) => {
        await items.insertOne({ n: 1 }, { session });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await items.countDocuments()).toBe(0);
  });
});
