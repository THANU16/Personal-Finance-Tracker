import mongoose, { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { parseRangeView } from "@/domain/date-range";
import { AccountModel } from "@/modules/accounts/model";
import { cashflowSeries, getSafeToSpend, netWorthSeries } from "@/modules/dashboard/queries";
import { getPortfolio } from "@/modules/holdings/queries";
import { TransactionModel } from "@/modules/transactions/model";
import { BACKUP_COLLECTIONS } from "@/modules/backup/service";
import { SettingsModel, type SettingsDoc } from "@/modules/settings/model";
import { ensureUserSetup } from "@/server/bootstrap";
import { runDailyForUser } from "@/server/cron/jobs/daily";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import { DEMO_MONTHS, findUserIdByEmail, seedDemoData } from "@/server/seed/demo";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

async function registeredUser(email: string) {
  const _id = new Types.ObjectId();
  await mongoose.connection.db!.collection("auth_users").insertOne({ _id, email, name: "Test" });
  const settings = await ensureUserSetup(String(_id));
  return { userId: String(_id), tz: settings.timezone, baseCurrency: settings.baseCurrency };
}

describe("demo seed (npm run seed -- <email>)", () => {
  it("fills only that account with 18 months of consistent data across every module", async () => {
    const ctx = await registeredUser("test@gmail.com");
    const other = await registeredUser("someone@example.com");
    expect(await findUserIdByEmail(mongoose.connection.db!, " Test@Gmail.com ")).toBe(ctx.userId);
    expect(await findUserIdByEmail(mongoose.connection.db!, "nobody@example.com")).toBeNull();

    const today = utcToBusinessDate(new Date(), ctx.tz);
    const summary = await seedDemoData(ctx, today);
    expect(DEMO_MONTHS).toBe(18);
    expect(summary.accounts).toBe(10); // 9 + the lease's loan account
    expect(summary.transactions).toBeGreaterThan(500);
    expect(summary.months).toBeGreaterThanOrEqual(18);
    expect(summary.sipExecutions).toBeGreaterThanOrEqual(15);
    expect(summary.notifications).toBeGreaterThan(0);

    const uid = new Types.ObjectId(ctx.userId);
    // nothing in the future, nothing for the other user
    expect(await TransactionModel.countDocuments({ userId: uid, date: { $gt: new Date() } })).toBe(
      0,
    );
    expect(await AccountModel.countDocuments({ userId: new Types.ObjectId(other.userId) })).toBe(0);

    // every module has data (auth-only and staging collections aside)
    const db = mongoose.connection.db!;
    const empty: string[] = [];
    for (const name of BACKUP_COLLECTIONS) {
      if (["attachments", "importBatches", "importRows", "importMappings"].includes(name)) continue;
      if ((await db.collection(name).countDocuments({ userId: uid })) === 0) empty.push(name);
    }
    expect(empty).toEqual([]);

    // no asset account went negative
    const accounts = await AccountModel.find({ userId: uid }).lean();
    for (const a of accounts) {
      if (!["credit_card", "loan", "payable"].includes(a.type))
        expect(a.balanceMinor, a.name).toBeGreaterThan(0);
    }

    // caches already match the ledger; the daily job runs cleanly on seeded data
    expect((await recomputeAllForUser(ctx)).changed).toBe(0);
    const settings = (await SettingsModel.findOne({ userId: uid }).lean<SettingsDoc>())!;
    const run = await runDailyForUser(settings);
    expect(Object.entries(run.steps).filter(([, s]) => !s.ok)).toEqual([]);

    // the dashboard has something to show everywhere
    const v = parseRangeView({ r: "1y" }, today);
    const nw = await netWorthSeries(ctx, v);
    expect(nw.points.at(-1)!.netWorthMinor).toBeGreaterThan(0);
    expect(nw.fxMissing).toBe(0); // USD rates were seeded
    const cf = await cashflowSeries(ctx, v);
    expect(cf.totals.incomeMinor).toBeGreaterThan(0);
    expect(cf.totals.expenseMinor).toBeGreaterThan(0);
    const safe = await getSafeToSpend(ctx);
    expect(safe.emergencyMinor).toBeGreaterThan(600_000_00); // NSB account + earmark
    expect(safe.opportunityMinor).toBeGreaterThan(300_000_00);
    const p = await getPortfolio(ctx);
    expect(p.totals.fxMissingCount).toBe(0);
    expect(p.holdings).toHaveLength(6);
  }, 180_000);
});
