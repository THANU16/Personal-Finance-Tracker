/**
 * Checks that MONGODB_URI (from .env.local) is reachable, is a replica set, and supports
 * multi-document transactions — WealthTrack's ledger depends on all three.
 *
 * Writes and deletes one document in the `_dbcheck` collection inside a transaction.
 * Usage: npm run db:check
 */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { parseEnv } from "../src/server/env";

function redact(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, "//***@");
}

async function main() {
  loadEnvConfig(process.cwd());
  const env = parseEnv(process.env);
  console.log(`Connecting to ${redact(env.MONGODB_URI)} ...`);

  const conn = await mongoose
    .createConnection(env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 })
    .asPromise();
  try {
    const db = conn.db;
    if (!db) throw new Error("No database handle after connecting");

    const hello = await db.admin().command({ hello: 1 });
    const setName: unknown = hello.setName;
    if (typeof setName !== "string") {
      throw new Error("Server is not a replica set member — transactions will not work.");
    }
    console.log(`✔ connected to database "${db.databaseName}" (replica set "${setName}")`);

    const session = await conn.startSession();
    try {
      await session.withTransaction(async () => {
        const coll = db.collection("_dbcheck");
        const { insertedId } = await coll.insertOne({ checkedAt: new Date() }, { session });
        await coll.deleteOne({ _id: insertedId }, { session });
      });
    } finally {
      await session.endSession();
    }
    console.log("✔ multi-document transaction committed");
    console.log("Database is ready for WealthTrack.");
  } finally {
    await conn.close();
  }
}

main().catch((err: unknown) => {
  console.error(`✘ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
