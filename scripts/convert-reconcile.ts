/**
 * One-off (docs/04 §1, owner request 2026-11-05): turns a user's existing reconcile adjustments into
 * expenses ("Bank fees") and income ("Interest"), so they count in cashflow, the savings rate and
 * budgets. Balances do not change (void + repost in one DB transaction). Archived accounts are skipped.
 *
 * Usage (PowerShell or any shell). Lists the changes first; nothing is written without --apply:
 *   npm run convert:reconcile -- you@example.com
 *   npm run convert:reconcile -- you@example.com --apply
 *
 * Uses MONGODB_URI from .env.local.
 */
import { loadEnvConfig } from "@next/env";

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  if (!email) {
    console.error("Usage: npm run convert:reconcile -- <email> [--apply]");
    process.exit(1);
  }

  loadEnvConfig(process.cwd());
  const mongoose = (await import("mongoose")).default;
  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { ensureUserSetup } = await import("../src/server/bootstrap");
  const { findUserIdByEmail } = await import("../src/server/seed/demo");
  const { convertReconcileAdjustments } = await import("../src/modules/accounts/service");
  const { formatMoney } = await import("../src/lib/format");

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
    const settings = await ensureUserSetup(userId);
    const ctx = { userId, tz: settings.timezone, baseCurrency: settings.baseCurrency };
    const rows = await convertReconcileAdjustments(ctx, { apply });
    if (rows.length === 0) {
      console.log("No reconcile adjustments to convert.");
      return;
    }
    console.table(
      rows.map((r) => ({
        date: r.date,
        account: r.accountName,
        amount: formatMoney(r.amountMinor, r.currency, { signed: true }),
        becomes: r.skipped ? `skipped: ${r.skipped}` : `${r.recordAs} · ${r.categoryName}`,
      })),
    );
    const done = rows.filter((r) => !r.skipped).length;
    console.log(
      apply
        ? `Converted ${done} reconciliation${done === 1 ? "" : "s"}. Balances are unchanged.`
        : `Dry run: ${done} would be converted. Run again with --apply to write the changes.`,
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
