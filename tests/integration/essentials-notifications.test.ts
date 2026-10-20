import mongoose, { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { utcToBusinessDate } from "@/domain/dates";
import { addDays } from "@/domain/recurring";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { EarmarkModel } from "@/modules/earmarks/model";
import { getAccountBuckets, setEarmark } from "@/modules/earmarks/service";
import {
  createPolicy,
  deletePolicy,
  getEmergency,
  getEssentials,
  listPolicies,
  setPolicyStatus,
  updatePolicy,
  useEmergencyFund,
} from "@/modules/essentials/service";
import { getForecast, getInsights, getProjection } from "@/modules/forecast/service";
import { createHolding } from "@/modules/holdings/service";
import { ValuationModel } from "@/modules/holdings/model";
import { NotificationModel } from "@/modules/notifications/model";
import {
  listNotifications,
  markAllRead,
  markRead,
  snooze,
  unreadCount,
} from "@/modules/notifications/service";
import { RecurringRuleModel } from "@/modules/recurring/model";
import { createRule } from "@/modules/recurring/service";
import { SettingsModel, type SettingsDoc } from "@/modules/settings/model";
import { updateSettings } from "@/modules/settings/service";
import { voidTransaction } from "@/modules/transactions/service";
import { runDailyForUser } from "@/server/cron/jobs/daily";
import type { Ctx } from "@/server/ctx";
import type { Mailer, MailMessage } from "@/server/mail/mailer";
import {
  assetClassId,
  balanceOf,
  categoryId,
  makeAccount,
  makeHolding,
  makeUser,
  post,
} from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const uid = (ctx: Ctx) => new Types.ObjectId(ctx.userId);
const today = () => utcToBusinessDate(new Date(), "Asia/Colombo");
/** The 15th of the month `offset` months before this one. */
function midMonth(offset: number): string {
  const [y, m] = today().split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) - offset;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-15`;
}
const settingsDoc = async (ctx: Ctx) =>
  (await SettingsModel.findOne({ userId: uid(ctx) }).lean<SettingsDoc>())!;
async function nonEssentialExpense(ctx: Ctx): Promise<string> {
  const c = await CategoryModel.findOne({
    userId: uid(ctx),
    kind: "expense",
    isEssential: false,
    parentId: { $ne: null },
  }).lean<CategoryDoc>();
  return String(c!._id);
}

async function spender() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, {
    name: "Bank",
    openingBalanceMinor: 10_000_000_00,
    openingDate: "2024-01-01",
  });
  return { ctx, bank };
}

describe("emergency fund (docs/04 §13, Phase 10)", () => {
  it("target honours the essential basis, the fallback to all, and the override", async () => {
    const { ctx, bank } = await spender();
    const groceries = await categoryId(ctx, "Groceries");
    const other = await nonEssentialExpense(ctx);
    // 6 complete months: groceries 60,000 each; other 30,000 in 3 of them.
    for (let i = 1; i <= 6; i++) {
      await post(ctx, {
        type: "expense",
        date: midMonth(i),
        amountMinor: 60_000_00,
        fromAccountId: bank.id,
        categoryId: groceries,
      });
      if (i <= 3) {
        await post(ctx, {
          type: "expense",
          date: midMonth(i),
          amountMinor: 30_000_00,
          fromAccountId: bank.id,
          categoryId: other,
        });
      }
    }
    // This month and 7 months ago do not count.
    await post(ctx, {
      type: "expense",
      date: today(),
      amountMinor: 999_000_00,
      fromAccountId: bank.id,
      categoryId: groceries,
    });
    await post(ctx, {
      type: "expense",
      date: midMonth(7),
      amountMinor: 999_000_00,
      fromAccountId: bank.id,
      categoryId: groceries,
    });

    const e = await getEmergency(ctx);
    expect(e).toMatchObject({
      basis: "essential",
      basisUsed: "essential",
      averageEssentialMinor: 60_000_00,
      averageAllMinor: 75_000_00,
      monthlyBasisMinor: 60_000_00,
      targetMinor: 360_000_00,
      targetSource: "basis",
    });

    await updateSettings(ctx, { emergencyExpenseBasis: "all", emergencyMonths: 4 });
    expect((await getEmergency(ctx)).targetMinor).toBe(300_000_00);

    await updateSettings(ctx, { emergencyTargetOverrideMinor: 1_000_000_00 });
    const o = await getEmergency(ctx);
    expect(o).toMatchObject({
      targetMinor: 1_000_000_00,
      targetSource: "override",
      monthlyBasisMinor: 75_000_00,
    });
  });

  it("essential basis falls back to all when nothing essential was spent", async () => {
    const { ctx, bank } = await spender();
    const other = await nonEssentialExpense(ctx);
    for (let i = 1; i <= 6; i++) {
      await post(ctx, {
        type: "expense",
        date: midMonth(i),
        amountMinor: 10_000_00,
        fromAccountId: bank.id,
        categoryId: other,
      });
    }
    expect(await getEmergency(ctx)).toMatchObject({
      basisUsed: "all",
      monthlyBasisMinor: 10_000_00,
      targetMinor: 60_000_00,
    });
  });

  it("current = earmarks + flagged accounts + flagged holdings; available vs locked; colours", async () => {
    const { ctx, bank } = await spender();
    await updateSettings(ctx, {
      emergencyExpenseBasis: "manual",
      emergencyManualMonthlyMinor: 100_000_00,
      emergencyMonths: 6,
    });
    await setEarmark(ctx, {
      accountId: bank.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 200_000_00,
    });
    await makeAccount(ctx, {
      name: "EF savings",
      openingBalanceMinor: 50_000_00,
      countsTowardEmergencyFund: true,
    });
    await makeHolding(ctx, {
      name: "Money market",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      investedMinor: 100_000_00,
      currentValueMinor: 100_000_00,
      liquidity: "high",
      countsTowardEmergencyFund: true,
    });
    await makeHolding(ctx, {
      name: "Locked bond",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      investedMinor: 50_000_00,
      currentValueMinor: 50_000_00,
      liquidity: "low",
      countsTowardEmergencyFund: true,
    });
    const e = await getEmergency(ctx);
    expect(e).toMatchObject({
      targetMinor: 600_000_00,
      currentMinor: 400_000_00,
      availableMinor: 350_000_00,
      lockedMinor: 50_000_00,
      progressBp: 6_666,
      tone: "amber",
      coverageTenths: 40,
    });
    expect(e.sources.map((s) => [s.kind, s.name, s.available])).toEqual([
      ["earmark", "Bank", true],
      ["holding", "Money market", true],
      ["account", "EF savings", true],
      ["holding", "Locked bond", false],
    ]);
  });

  it("Use emergency fund: the earmark drops by the amount, opportunity and free untouched; void restores the balance", async () => {
    const { ctx, bank } = await spender();
    await setEarmark(ctx, {
      accountId: bank.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 300_000_00,
    });
    await setEarmark(ctx, {
      accountId: bank.id,
      bucket: "opportunity",
      mode: "fixed",
      amountMinor: 200_000_00,
    });
    const before = await getAccountBuckets(ctx, bank.id);
    const medical = await categoryId(ctx, "Groceries");
    const { id } = await useEmergencyFund(ctx, {
      accountId: bank.id,
      kind: "expense",
      amountMinor: 120_000_00,
      date: today(),
      categoryId: medical,
    });
    const after = await getAccountBuckets(ctx, bank.id);
    expect(after.emergencyMinor).toBe(180_000_00);
    expect(after.opportunityMinor).toBe(200_000_00);
    expect(after.freeMinor).toBe(before.freeMinor);
    expect(await balanceOf(ctx, bank.id)).toBe(10_000_000_00 - 120_000_00);

    await expect(
      useEmergencyFund(ctx, {
        accountId: bank.id,
        kind: "expense",
        amountMinor: 180_000_01,
        date: today(),
        categoryId: medical,
      }),
    ).rejects.toThrow(/More than the emergency earmark/);

    await voidTransaction(ctx, id, { reason: "test" });
    expect(await balanceOf(ctx, bank.id)).toBe(10_000_000_00);
  });

  it("Use emergency fund as a transfer from an emergency-flagged account", async () => {
    const { ctx, bank } = await spender();
    const ef = await makeAccount(ctx, {
      name: "EF",
      openingBalanceMinor: 80_000_00,
      countsTowardEmergencyFund: true,
    });
    await useEmergencyFund(ctx, {
      accountId: ef.id,
      kind: "transfer",
      amountMinor: 30_000_00,
      date: today(),
      toAccountId: bank.id,
    });
    expect(await balanceOf(ctx, ef.id)).toBe(50_000_00);
    expect(await balanceOf(ctx, bank.id)).toBe(10_000_000_00 + 30_000_00);
  });
});

describe("insurance and health score", () => {
  it("policies CRUD; cover vs target feeds the score", async () => {
    const { ctx, bank } = await spender();
    const salary = await categoryId(ctx, "Salary");
    for (let i = 1; i <= 12; i++) {
      await post(ctx, {
        type: "income",
        date: midMonth(i),
        amountMinor: 100_000_00,
        toAccountId: bank.id,
        categoryId: salary,
      });
    }
    await updateSettings(ctx, {
      lifeCoverIncomeMultiple: 10,
      healthCoverTargetMinor: 1_000_000_00,
    });
    const { id } = await createPolicy(ctx, {
      type: "life",
      provider: "AIA",
      policyNumberLast4: "1234",
      coverMinor: 6_000_000_00,
      premiumMinor: 5_000_00,
      premiumFrequency: "monthly",
      startDate: "2025-01-01",
      renewalDate: addDays(today(), 10),
    });
    await createPolicy(ctx, {
      type: "health",
      provider: "Ceylinco",
      coverMinor: 1_000_000_00,
      premiumMinor: 40_000_00,
      premiumFrequency: "yearly",
      startDate: "2025-01-01",
      renewalDate: addDays(today(), 200),
    });
    const ess = await getEssentials(ctx);
    expect(ess.insurance).toMatchObject({
      annualIncomeMinor: 1_200_000_00,
      lifeTargetMinor: 12_000_000_00,
      lifeCoverMinor: 6_000_000_00,
      healthCoverMinor: 1_000_000_00,
      annualPremiumMinor: 100_000_00,
    });
    expect(ess.score.parts.insurance.points).toBe(18.8); // 6.25 + 12.5
    expect(ess.score.parts.savings.points).toBe(25); // no expense → 100% savings
    expect(ess.score.parts.debt.points).toBe(20); // no loans

    await updatePolicy(ctx, id, {
      type: "life",
      provider: "AIA",
      coverMinor: 12_000_000_00,
      premiumMinor: 5_000_00,
      premiumFrequency: "monthly",
      startDate: "2025-01-01",
      renewalDate: addDays(today(), 10),
    });
    expect((await listPolicies(ctx)).find((p) => p.id === id)?.coverMinor).toBe(12_000_000_00);
    await setPolicyStatus(ctx, id, "lapsed");
    expect((await listPolicies(ctx)).find((p) => p.id === id)?.status).toBe("lapsed");
    await deletePolicy(ctx, id);
    expect(await listPolicies(ctx)).toHaveLength(1);

    const other = await makeUser();
    await expect(deletePolicy(other, (await listPolicies(ctx))[0]!.id)).rejects.toThrow(
      /not found/,
    );
  });
});

describe("forecast and projection (docs/04 §17, §22)", () => {
  it("flags a seeded negative balance on the day it happens", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Low bank", openingBalanceMinor: 10_000_00 });
    const rent = await categoryId(ctx, "Groceries");
    const due = addDays(today(), 5);
    await createRule(ctx, {
      name: "Rent",
      kind: "expense",
      amountMinor: 50_000_00,
      fromAccountId: bank.id,
      categoryId: rent,
      frequency: "monthly",
      dayOfMonth: Number(due.slice(8, 10)),
      startDate: due,
    });
    const f = await getForecast(ctx, 30);
    const a = f.accounts.find((x) => x.id === bank.id)!;
    expect(a.breach).toEqual({ date: due, balanceMinor: -40_000_00, below: "zero" });
    expect(f.total.breach?.date).toBe(due);
    expect(f.days).toHaveLength(30);
    expect(f.events.some((e) => e.title === "Rent" && e.deltaMinor === -50_000_00)).toBe(true);
  });

  it("projection starts at net worth and adds monthly SIP equivalents (estimate)", async () => {
    const ctx = await makeUser();
    await makeAccount(ctx, { openingBalanceMinor: 1_000_000_00 });
    const p = await getProjection(ctx);
    expect(p.startMinor).toBe(1_000_000_00);
    expect(p.monthlyContributionMinor).toBe(0);
    expect(p.annualReturnBp).toBe(800);
    expect(p.points).toHaveLength(11);
    expect(p.points[10]!.baseMinor).toBeGreaterThan(p.points[10]!.lowMinor);
  });

  it("insights run on a real user without failing", async () => {
    const { ctx } = await spender();
    expect(Array.isArray(await getInsights(ctx))).toBe(true);
  });
});

describe("daily job and notifications (docs/04 §19)", () => {
  function captureMailer(): Mailer & { sent: MailMessage[] } {
    const sent: MailMessage[] = [];
    return {
      driver: "console",
      sent,
      async send(m) {
        sent.push(m);
      },
    };
  }

  it("running the cron twice creates no duplicates", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Low bank", openingBalanceMinor: 10_000_00 });
    const rent = await categoryId(ctx, "Groceries");
    const due = addDays(today(), 2);
    await createRule(ctx, {
      name: "Rent",
      kind: "expense",
      amountMinor: 50_000_00,
      fromAccountId: bank.id,
      categoryId: rent,
      frequency: "monthly",
      dayOfMonth: Number(due.slice(8, 10)),
      startDate: due,
      reminderDaysBefore: 3,
    });
    await createPolicy(ctx, {
      type: "vehicle",
      provider: "Allianz",
      coverMinor: 1,
      premiumMinor: 1,
      premiumFrequency: "yearly",
      startDate: "2025-01-01",
      renewalDate: addDays(today(), 20),
    });
    const settings = await settingsDoc(ctx);
    const mailer = captureMailer();
    const first = await runDailyForUser(settings, { mailer });
    expect(Object.values(first.steps).every((s) => s.ok)).toBe(true);
    const keys = (await NotificationModel.find({ userId: uid(ctx) }).lean())
      .map((n) => n.dedupeKey)
      .sort();
    const ruleId = String((await RecurringRuleModel.findOne({ userId: uid(ctx) }).lean())!._id);
    expect(keys).toEqual(
      [
        `fc:${bank.id}:${due}`,
        `ins:${(await listPolicies(ctx))[0]!.id}:${addDays(today(), 20)}`,
        `rec:${ruleId}:${due}`,
      ].sort(),
    );
    expect(first.steps.notifications).toEqual({ ok: true, detail: 3 });

    const second = await runDailyForUser(settings, { mailer });
    expect(second.steps.notifications).toEqual({ ok: true, detail: 0 });
    expect(await NotificationModel.countDocuments({ userId: uid(ctx) })).toBe(3);
    // Email is off by default and the console driver never sends a digest.
    expect(mailer.sent).toHaveLength(0);
  });

  it("over-earmarked is raised once, cleared when resolved", async () => {
    const ctx = await makeUser();
    const bank = await makeAccount(ctx, { name: "Bank", openingBalanceMinor: 100_000_00 });
    await setEarmark(ctx, {
      accountId: bank.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 60_000_00,
    });
    // Stored earmark above the balance (e.g. after a void): over-earmarked (docs/04 §20).
    await EarmarkModel.updateOne(
      { userId: uid(ctx), accountId: new Types.ObjectId(bank.id) },
      { $set: { amountMinor: 150_000_00 } },
    );
    const settings = await settingsDoc(ctx);
    const count = () =>
      NotificationModel.countDocuments({ userId: uid(ctx), dedupeKey: `earm:${bank.id}` });
    await runDailyForUser(settings);
    expect(await count()).toBe(1);
    await runDailyForUser(settings);
    expect(await count()).toBe(1);
    const salary = await categoryId(ctx, "Salary");
    await post(ctx, {
      type: "income",
      date: today(),
      amountMinor: 50_000_00,
      toAccountId: bank.id,
      categoryId: salary,
    });
    await runDailyForUser(settings);
    expect(await count()).toBe(0);
  });

  it("FD job writes fd_calc valuations at maturity once", async () => {
    const ctx = await makeUser();
    await makeAccount(ctx, { openingBalanceMinor: 0, openingDate: "2025-01-01" });
    const fd = await createHolding(ctx, {
      name: "FD",
      assetClassId: await assetClassId(ctx, "Fixed Income"),
      instrumentType: "fd",
      currency: "LKR",
      fd: {
        principalMinor: 100_000_000,
        rateBp: 1_000,
        startDate: "2025-01-01",
        maturityDate: "2026-01-01",
        compounding: "simple",
        payout: "at_maturity",
      },
    });
    const settings = await settingsDoc(ctx);
    const r1 = await runDailyForUser(settings);
    expect(r1.steps.fd).toEqual({ ok: true, detail: 1 });
    await runDailyForUser(settings);
    const vals = await ValuationModel.find({
      userId: uid(ctx),
      holdingId: new Types.ObjectId(fd.id),
      source: "fd_calc",
    }).lean();
    expect(vals).toHaveLength(1);
    expect(vals[0]!.valueMinor).toBe(110_000_000);
    // Matured FD: maturing notification was 7 days before, so none now.
    expect(await NotificationModel.countDocuments({ userId: uid(ctx), type: "fd_maturing" })).toBe(
      0,
    );
  });

  it("digest is emailed once when email is on and Resend is the driver", async () => {
    const ctx = await makeUser();
    await mongoose.connection
      .db!.collection("auth_users")
      .insertOne({ _id: uid(ctx), email: "me@example.com", name: "Me" });
    await createPolicy(ctx, {
      type: "home",
      provider: "SLIC",
      coverMinor: 1,
      premiumMinor: 1,
      premiumFrequency: "yearly",
      startDate: "2025-01-01",
      renewalDate: addDays(today(), 5),
    });
    const sent: MailMessage[] = [];
    const resend: Mailer = {
      driver: "resend",
      async send(m) {
        sent.push(m);
      },
    };
    // Email off: nothing sent.
    await runDailyForUser(await settingsDoc(ctx), { mailer: resend });
    expect(sent).toHaveLength(0);
    await updateSettings(ctx, { notify: { email: true, inApp: true, dailyHourLocal: 6 } });
    await runDailyForUser(await settingsDoc(ctx), { mailer: resend });
    await runDailyForUser(await settingsDoc(ctx), { mailer: resend });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "me@example.com",
      subject: expect.stringContaining("SLIC"),
    });
    expect(sent[0]!.text).toContain("/essentials");
    expect(
      await NotificationModel.countDocuments({ userId: uid(ctx), emailedAt: { $ne: null } }),
    ).toBe(1);
  });

  it("list, read, snooze and unread count", async () => {
    const ctx = await makeUser();
    await NotificationModel.create([
      { userId: uid(ctx), type: "system", title: "A", dedupeKey: "a", severity: "info" },
      { userId: uid(ctx), type: "system", title: "B", dedupeKey: "b", severity: "info" },
      { userId: uid(ctx), type: "system", title: "C", dedupeKey: "c", severity: "info" },
    ]);
    expect(await unreadCount(ctx)).toBe(3);
    const list = await listNotifications(ctx);
    await markRead(ctx, list.find((n) => n.title === "A")!.id);
    expect(await unreadCount(ctx)).toBe(2);
    await snooze(ctx, list.find((n) => n.title === "B")!.id, 3);
    expect((await listNotifications(ctx)).map((n) => n.title).sort()).toEqual(["A", "C"]);
    expect(await unreadCount(ctx)).toBe(1);
    await expect(snooze(ctx, list[0]!.id, 2)).rejects.toThrow();
    await markAllRead(ctx);
    expect(await unreadCount(ctx)).toBe(0);
    const other = await makeUser();
    await expect(markRead(other, list[0]!.id)).rejects.toThrow(/not found/);
  });
});
