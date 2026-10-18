/**
 * Rebuilds every account/holding cache from the ledger (docs/04 §1, §3). Idempotent: a second run
 * reports 0 changed. Pass an email to limit it to one user.
 *
 * Usage (PowerShell or any shell): npm run recompute            (every user)
 *                                  npm run recompute -- me@x.com (one user)
 */
import { loadEnvConfig } from "@next/env";
import mongoose, { Types } from "mongoose";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
  loadEnvConfig(process.cwd());
  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { recomputeAllForUser } = await import("../src/server/ledger/recompute-all");
  const { findUserIdByEmail } = await import("../src/server/seed/demo");
  const { SettingsModel } = await import("../src/modules/settings/model");
  const { AccountModel } = await import("../src/modules/accounts/model");

  await connectDb();
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database connection");
    let userIds: string[];
    if (email) {
      const id = await findUserIdByEmail(db, email);
      if (!id) {
        console.error(`No user with email ${email}.`);
        process.exitCode = 1;
        return;
      }
      userIds = [id];
    } else {
      const ids = await AccountModel.distinct("userId").setOptions({ skipUserIdGuard: true });
      userIds = ids.map(String);
    }
    for (const userId of userIds) {
      const settings = await SettingsModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
      const tz = settings?.timezone ?? "Asia/Colombo";
      const r = await recomputeAllForUser({ userId, tz });
      console.log(
        `${userId}: ${r.accounts} accounts, ${r.holdings} holdings, ${r.changed} changed`,
      );
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
