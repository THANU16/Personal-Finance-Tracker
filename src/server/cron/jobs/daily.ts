import "server-only";
import mongoose from "mongoose";
import { cardOutstandingMinor, nextMonthlyDate } from "@/domain/accounts";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { lastPayoutDate } from "@/domain/fd";
import { buildNotifications, type NotificationState } from "@/domain/notifications";
import { addDays, reminderDate } from "@/domain/recurring";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { getBudgetMonth } from "@/modules/budgets/service";
import { getAttention } from "@/modules/dashboard/queries";
import { debtUpcoming } from "@/modules/debts/service";
import { listAccountBuckets } from "@/modules/earmarks/service";
import { listPolicies } from "@/modules/essentials/service";
import { getForecast } from "@/modules/forecast/service";
import { listGoals } from "@/modules/goals/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { runFdDailyJob } from "@/modules/holdings/service";
import {
  clearResolved,
  markEmailed,
  pendingEmail,
  raiseNotifications,
} from "@/modules/notifications/service";
import { detectOpportunityTriggers } from "@/modules/opportunity-fund/service";
import { RecurringRuleModel, type RecurringRuleDoc } from "@/modules/recurring/model";
import { debtIdsWithRules } from "@/modules/recurring/service";
import { SettingsModel, type SettingsDoc } from "@/modules/settings/model";
import {
  SipExecutionModel,
  SipPlanModel,
  type SipExecutionDoc,
  type SipPlanDoc,
} from "@/modules/sip/model";
import { generateDueExecutions } from "@/modules/sip/service";
import { ensureMonthEndSnapshot } from "@/modules/snapshots/service";
import { ensureMonthlyReview } from "@/modules/reports/service";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { getEnv } from "@/server/env";
import { getMailer, type Mailer } from "@/server/mail/mailer";
import { notificationDigestEmail } from "@/server/mail/templates";
import { fdTerms } from "@/server/ledger/holding-events";

// Daily job (docs/06 Phase 10, docs/04 §16 §19): SIP generation + missed marking, FD valuations and
// maturity, month-end snapshot, opportunity triggers, every §19 notification, optional email. Every
// step is idempotent and isolated: one failing step is reported and the others still run.

export type StepName = "sip" | "fd" | "snapshot" | "review" | "notifications" | "email";

export interface UserRunResult {
  userId: string;
  today: string;
  steps: Partial<Record<StepName, { ok: true; detail: number } | { ok: false; error: string }>>;
}

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
/** Old overdue SIPs are not announced on the first run (only the last 30 days). */
const OVERDUE_LOOKBACK_DAYS = 30;
/** Payout-FD interest dates older than this are not announced. */
const PAYOUT_LOOKBACK_DAYS = 7;

/** Everything the §19 rules look at, gathered for one user. */
export async function gatherNotificationState(ctx: Ctx, today: string): Promise<NotificationState> {
  const userId = uid(ctx);
  const [
    executions,
    plans,
    rules,
    accounts,
    holdings,
    emis,
    covered,
    policies,
    attention,
    budget,
    goals,
    triggers,
    forecast,
    buckets,
  ] = await Promise.all([
    SipExecutionModel.find({
      userId,
      status: { $in: ["due", "missed"] },
      dueDate: {
        $gte: businessDateToUtc(addDays(today, -OVERDUE_LOOKBACK_DAYS), ctx.tz),
        $lte: businessDateToUtc(addDays(today, 2), ctx.tz),
      },
    }).lean<SipExecutionDoc[]>(),
    SipPlanModel.find({ userId }).lean<SipPlanDoc[]>(),
    RecurringRuleModel.find({ userId, status: "active", nextDueDate: { $ne: null } }).lean<
      RecurringRuleDoc[]
    >(),
    AccountModel.find({ userId, archivedAt: null }).lean<AccountDoc[]>(),
    HoldingModel.find({ userId, status: "active", fd: { $ne: null } }).lean<HoldingDoc[]>(),
    debtUpcoming(ctx, addDays(today, 3)),
    debtIdsWithRules(ctx),
    listPolicies(ctx),
    getAttention(ctx),
    getBudgetMonth(ctx, today.slice(0, 7)),
    listGoals(ctx),
    detectOpportunityTriggers(ctx),
    getForecast(ctx, 30),
    listAccountBuckets(ctx),
  ]);
  const planName = new Map(plans.map((p) => [String(p._id), p.name]));
  const byAccount = new Map(accounts.map((a) => [String(a._id), a]));
  return {
    today,
    sipExecutions: executions.map((e) => ({
      id: String(e._id),
      planName: planName.get(String(e.planId)) ?? "SIP",
      dueDate: utcToBusinessDate(e.dueDate, ctx.tz),
      status: e.status,
    })),
    recurring: rules.map((r) => ({
      ruleId: String(r._id),
      name: r.name,
      dueDate: r.nextDueDate!,
      reminderDate: reminderDate(r.nextDueDate!, r.reminderDaysBefore),
    })),
    emis: emis
      .map((e) => ({
        debtId: e.href.replace("/debts/", ""),
        name: e.title.replace(/ EMI$/, ""),
        dueDate: e.dueDate,
      }))
      .filter((e) => !covered.has(e.debtId)),
    cards: accounts
      .filter((a) => a.type === "credit_card" && a.creditCard)
      .map((a) => ({
        accountId: String(a._id),
        name: a.name,
        dueDate: nextMonthlyDate(today, a.creditCard!.dueDay),
        outstandingMinor: cardOutstandingMinor(a.balanceMinor),
      })),
    fds: holdings.flatMap((h) => {
      const t = fdTerms(h, ctx.tz);
      return t ? [{ holdingId: String(h._id), name: h.name, maturityDate: t.maturityDate }] : [];
    }),
    fdPayouts: holdings.flatMap((h) => {
      const t = fdTerms(h, ctx.tz);
      const date = t ? lastPayoutDate(t, today) : null;
      return date && date >= addDays(today, -PAYOUT_LOOKBACK_DAYS)
        ? [{ holdingId: String(h._id), name: h.name, payoutDate: date }]
        : [];
    }),
    policies: policies
      .filter((p) => p.status === "active")
      .map((p) => ({
        id: p.id,
        label: `${p.provider} (${p.type.replace("_", " ")})`,
        renewalDate: p.renewalDate,
      })),
    staleCount: attention.staleCount,
    budgets: budget.rows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      month: budget.month,
      spentMinor: r.spentMinor,
      limitMinor: r.budgetMinor,
    })),
    offTrackGoals: goals.goals
      .filter((g) => !g.archived && g.status === "off_track")
      .map((g) => ({ goalId: g.id, name: g.name })),
    opportunity: triggers.map((t) => ({ dedupeKey: t.dedupeKey, drawdownBp: t.drawdownBp })),
    negativeForecast: forecast.accounts.flatMap((a) =>
      a.breach
        ? [{ accountId: a.id, name: a.name, date: a.breach.date, below: a.breach.below }]
        : [],
    ),
    overEarmarked: [...buckets.values()]
      .filter((b) => b.overEarmarked && !b.archived)
      .map((b) => ({
        accountId: b.accountId,
        name: byAccount.get(b.accountId)?.name ?? "Account",
      })),
  };
}

/** Raises every §19 notification due today; clears over_earmarked ones that no longer apply. */
export async function runNotifications(ctx: Ctx, today: string): Promise<number> {
  const state = await gatherNotificationState(ctx, today);
  const drafts = buildNotifications(state);
  await clearResolved(
    ctx,
    "over_earmarked",
    drafts.filter((d) => d.type === "over_earmarked").map((d) => d.dedupeKey),
  );
  return raiseNotifications(ctx, drafts);
}

async function userEmail(userId: string): Promise<{ email: string; name: string } | null> {
  const db = mongoose.connection.db;
  if (!db) return null;
  const u = await db
    .collection<{ email?: string; name?: string }>("auth_users")
    .findOne({ _id: toObjectId(userId, "User") });
  return u?.email ? { email: u.email, name: u.name || u.email } : null;
}

/**
 * Digest of unread, not-yet-emailed notifications — only with email on AND Resend configured (the
 * mailer is Resend only when RESEND_API_KEY is set; the console driver never sends reminders).
 */
async function sendDigest(ctx: Ctx, settings: SettingsDoc, mailer: Mailer): Promise<number> {
  if (!settings.notify?.email || mailer.driver !== "resend") return 0;
  const env = getEnv();
  const pending = await pendingEmail(ctx);
  if (!pending.length) return 0;
  const user = await userEmail(ctx.userId);
  if (!user) return 0;
  await mailer.send(
    notificationDigestEmail(
      user,
      pending.map((p) => ({ title: p.title, body: p.body, link: p.link })),
      env.APP_URL,
    ),
  );
  await markEmailed(
    ctx,
    pending.map((p) => p._id),
  );
  return pending.length;
}

async function step(
  result: UserRunResult,
  name: StepName,
  fn: () => Promise<number>,
): Promise<void> {
  try {
    result.steps[name] = { ok: true, detail: await fn() };
  } catch (err) {
    result.steps[name] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** All daily steps for one user. `todayKey` overrides the date (tests). */
export async function runDailyForUser(
  settings: SettingsDoc,
  opts: { todayKey?: string; mailer?: Mailer } = {},
): Promise<UserRunResult> {
  const ctx: Ctx = {
    userId: String(settings.userId),
    tz: settings.timezone,
    baseCurrency: settings.baseCurrency,
  };
  const today = opts.todayKey ?? utcToBusinessDate(new Date(), ctx.tz);
  const result: UserRunResult = { userId: ctx.userId, today, steps: {} };
  await step(result, "sip", () => generateDueExecutions(ctx, today));
  await step(result, "fd", async () => (await runFdDailyJob(ctx, today)).valuations);
  await step(result, "snapshot", async () => ((await ensureMonthEndSnapshot(ctx, today)) ? 1 : 0));
  await step(result, "review", async () => ((await ensureMonthlyReview(ctx, today)) ? 1 : 0));
  await step(result, "notifications", () => runNotifications(ctx, today));
  await step(result, "email", () => sendDigest(ctx, settings, opts.mailer ?? getMailer()));
  return result;
}

/** The cron entry point: every user, one after another. */
export async function runDailyJob(
  opts: { todayKey?: string; mailer?: Mailer } = {},
): Promise<UserRunResult[]> {
  await connectDb();
  const all = await SettingsModel.find({})
    .setOptions({ skipUserIdGuard: true })
    .lean<SettingsDoc[]>();
  const results: UserRunResult[] = [];
  for (const s of all) results.push(await runDailyForUser(s, opts));
  return results;
}
