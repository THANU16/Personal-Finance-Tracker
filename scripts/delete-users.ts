/**
 * Permanently deletes users and ALL their data (login, sessions, 2FA, settings, accounts, ledger,
 * holdings, imports, audit log — every collection that carries their userId). Owner tool for removing
 * test or unwanted accounts; it bypasses the "never hard-delete posted records" rule on purpose.
 *
 * Dry run by default (prints what would be removed). Add --confirm to delete.
 *
 * Usage (PowerShell or any shell):
 *   npm run delete-users -- <userId> [<userId> …]            (dry run)
 *   npm run delete-users -- <userId> [<userId> …] --confirm  (delete)
 */
import { loadEnvConfig } from "@next/env";
import mongoose, { Types } from "mongoose";

const AUTH_USERS = "auth_users";
const AUTH_VERIFICATIONS = "auth_verifications";

function filterFor(collection: string, id: Types.ObjectId) {
  if (collection === AUTH_USERS) return { _id: id };
  // Better Auth stores the user id as the verification value (reset / verify tokens).
  if (collection === AUTH_VERIFICATIONS) return { value: String(id) };
  return { userId: { $in: [id, String(id)] } };
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const ids = args.filter((a) => !a.startsWith("--"));
  if (!ids.length || ids.some((id) => !/^[0-9a-f]{24}$/i.test(id))) {
    console.error("Usage: npm run delete-users -- <userId> [<userId> …] [--confirm]");
    process.exit(1);
  }
  loadEnvConfig(process.cwd());
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database connection");
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith("system."))
      .sort();

    for (const raw of ids) {
      const id = new Types.ObjectId(raw);
      const user = await db
        .collection(AUTH_USERS)
        .findOne({ _id: id }, { projection: { email: 1, name: 1, createdAt: 1 } });
      console.log(
        `\n${raw}: ${user ? `${String(user.name)} <${String(user.email)}>` : "NO LOGIN RECORD (data only)"}`,
      );
      const counts: [string, number][] = [];
      for (const name of collections) {
        const n = await db.collection(name).countDocuments(filterFor(name, id));
        if (n) counts.push([name, n]);
      }
      if (!counts.length) {
        console.log("  nothing found");
        continue;
      }
      for (const [name, n] of counts) console.log(`  ${name.padEnd(28)} ${n}`);
      if (!confirm) continue;

      // One transaction per user: either all of a user's data goes, or none of it.
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          for (const [name] of counts) {
            await db.collection(name).deleteMany(filterFor(name, id), { session });
          }
        });
        console.log("  → deleted");
      } finally {
        await session.endSession();
      }
    }
    if (!confirm) console.log("\nDry run — nothing was deleted. Re-run with --confirm to delete.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
