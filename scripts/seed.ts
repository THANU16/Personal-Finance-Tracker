/**
 * Adds 18 months of realistic LKR demo data across every module (accounts, transactions, holdings and
 * values, an FD, SIP periods, target allocation, Opportunity Fund, a lease, recurring rules, budgets,
 * goals, insurance, earmarks, snapshots, a monthly review, notifications) to ONE existing user, found
 * by email. Other users are untouched.
 *
 * Usage (PowerShell or any shell):
 *   npm run seed -- test@gmail.com
 *   npm run seed -- test@gmail.com --append   # add again even if the user already has accounts
 *
 * The user must have registered (and logged in once) first. Uses MONGODB_URI from .env.local.
 */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const append = args.includes("--append");
  if (!email) {
    console.error("Usage: npm run seed -- <email> [--append]");
    process.exit(1);
  }

  loadEnvConfig(process.cwd());
  // Imported after the env is loaded (they read it at import/use time).
  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { ensureUserSetup } = await import("../src/server/bootstrap");
  const { utcToBusinessDate } = await import("../src/domain/dates");
  const { accountCount, findUserIdByEmail, seedDemoData } = await import("../src/server/seed/demo");

  await connectDb();
  // Create every collection and index up front: creating them inside the seed's transactions
  // conflicts with Mongoose's background index builds on a fresh database.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database connection");
    const userId = await findUserIdByEmail(db, email);
    if (!userId) {
      console.error(`No user with email ${email}. Register in the app first, then run this again.`);
      process.exitCode = 1;
      return;
    }
    const settings = await ensureUserSetup(userId);
    const ctx = { userId, tz: settings.timezone, baseCurrency: settings.baseCurrency };
    const existing = await accountCount(ctx);
    if (existing > 0 && !append) {
      console.error(
        `${email} already has ${existing} account(s). Nothing was changed. ` +
          "Run with --append to add the demo data anyway.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Seeding demo data for ${email} (base ${ctx.baseCurrency}, ${ctx.tz})…`);
    const summary = await seedDemoData(ctx, utcToBusinessDate(new Date(), ctx.tz));
    console.log(
      `Done: ${summary.accounts} accounts, ${summary.transactions} transactions, ` +
        `${summary.holdings} holdings, ${summary.sipExecutions} SIP periods executed, ${summary.months} month-end snapshots, ` +
        `${summary.notifications} notifications.`,
    );
  } finally {
    await disconnectDb();
  }
}

main()
  // Exit explicitly: pooled connections or timers in imported modules must not keep the CLI alive.
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
