import mongoose, { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { parseRangeView } from "@/domain/date-range";
import { AccountModel } from "@/modules/accounts/model";
import { cashflowSeries, getSafeToSpend, netWorthSeries } from "@/modules/dashboard/queries";
import { getPortfolio } from "@/modules/holdings/queries";
import { TransactionModel } from "@/modules/transactions/model";
import { ensureUserSetup } from "@/server/bootstrap";
import { findUserIdByEmail, seedDemoData } from "@/server/seed/demo";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

async function registeredUser(email: string) {
  const _id = new Types.ObjectId();
  await mongoose.connection.db!.collection("auth_users").insertOne({ _id, email, name: "Test" });
  const settings = await ensureUserSetup(String(_id));
  return { userId: String(_id), tz: settings.timezone, baseCurrency: settings.baseCurrency };
}

describe("demo seed (npm run seed -- <email>)", () => {
  it("finds the user by email and fills only that account with consistent data", async () => {
    const ctx = await registeredUser("test@gmail.com");
    const other = await registeredUser("someone@example.com");
    expect(await findUserIdByEmail(mongoose.connection.db!, " Test@Gmail.com ")).toBe(ctx.userId);
    expect(await findUserIdByEmail(mongoose.connection.db!, "nobody@example.com")).toBeNull();

    const today = utcToBusinessDate(new Date(), ctx.tz);
    const summary = await seedDemoData(ctx, today);
    expect(summary.accounts).toBe(8);
    expect(summary.transactions).toBeGreaterThan(80);
    expect(summary.months).toBe(6);

    // nothing in the future, nothing for the other user
    const uid = new Types.ObjectId(ctx.userId);
    const future = await TransactionModel.countDocuments({
      userId: uid,
      date: { $gt: new Date() },
    });
    expect(future).toBe(0);
    expect(await AccountModel.countDocuments({ userId: new Types.ObjectId(other.userId) })).toBe(0);

    // no account went negative except the credit card
    const accounts = await AccountModel.find({ userId: uid }).lean();
    for (const a of accounts) {
      if (a.type !== "credit_card") expect(a.balanceMinor, a.name).toBeGreaterThan(0);
    }

    // the dashboard has something to show everywhere
    const v = parseRangeView({ r: "6m" }, today);
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
    expect(p.holdings).toHaveLength(5);
  });
});
