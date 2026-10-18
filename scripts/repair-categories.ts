/**
 * Merges duplicated categories for ONE user (found by email) and finishes their first-login setup.
 * Transactions, split lines and sub-categories move to the kept copy first; nothing else changes.
 * Safe to run again: with no duplicates it does nothing.
 *
 * Usage (PowerShell or any shell): npm run repair:categories -- test@gmail.com
 */
import { loadEnvConfig } from "@next/env";
import mongoose, { Types } from "mongoose";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!email) {
    console.error("Usage: npm run repair:categories -- <email>");
    process.exit(1);
  }
  loadEnvConfig(process.cwd());
  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { mergeDuplicateCategories } = await import("../src/modules/categories/dedupe");
  const { ensureUserSetup } = await import("../src/server/bootstrap");
  const { findUserIdByEmail } = await import("../src/server/seed/demo");
  const { CategoryModel } = await import("../src/modules/categories/model");

  await connectDb();
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database connection");
    const userId = await findUserIdByEmail(db, email);
    if (!userId) {
      console.error(`No user with email ${email}.`);
      process.exitCode = 1;
      return;
    }
    const count = () => CategoryModel.countDocuments({ userId: new Types.ObjectId(userId) });
    const before = await count();
    // Outside one big transaction: each step is atomic on its own and the merge can be re-run.
    const session = await mongoose.startSession();
    try {
      await mergeDuplicateCategories(userId, session);
    } finally {
      await session.endSession();
    }
    // Finishes first-login setup too (it also merges, so report the real before/after counts).
    await ensureUserSetup(userId);
    const after = await count();
    console.log(
      `${email}: ${before} categories before, ${before - after} duplicates removed, ${after} now.`,
    );
  } finally {
    await disconnectDb();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
