import "server-only";
import { cardOutstandingMinor, nextMonthlyDate } from "@/domain/accounts";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { EARMARKABLE_TYPES } from "@/domain/earmarks";
import {
  FORECAST_HORIZONS,
  forecastBalances,
  monthlyEquivalent,
  projectNetWorth,
  type Forecast,
  type ForecastEvent,
  type ForecastHorizon,
  type ProjectionPoint,
} from "@/domain/forecast";
import { computeInsights, type Insight } from "@/domain/insights";
import { addDays } from "@/domain/recurring";
import { computeNetWorthSeries } from "@/domain/series";
import { steppedAmount } from "@/domain/sip";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { getBudgetMonth, spendLines } from "@/modules/budgets/service";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { completeMonthFlows, getAttention, getUpcoming } from "@/modules/dashboard/queries";
import { loadSeriesInput } from "@/modules/dashboard/series-input";
import { debtIdsWithRules, recurringUpcoming } from "@/modules/recurring/service";
import { debtUpcoming } from "@/modules/debts/service";
import { getBucketsInBase } from "@/modules/earmarks/service";
import { getEmergency } from "@/modules/essentials/service";
import { loadToBase } from "@/modules/fx/service";
import { getSettings } from "@/modules/settings/service";
import { SipExecutionModel, SipPlanModel, type SipPlanDoc } from "@/modules/sip/model";
import { sipUpcoming } from "@/modules/sip/queries";
import { TransactionModel, type TransactionDoc } from "@/modules/transactions/model";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";

// docs/04 §17 forecast, §22 net worth projection and insights. Phase 10 decisions: the forecast
// covers cash accounts (bank, cash, wallet, broker cash, Opportunity Fund) in base currency; a card
// due has no payment account (accounts carry none), so it moves the total only.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);
const FORECAST_TYPES = [...EARMARKABLE_TYPES, "opportunity_fund"];

export function parseHorizon(raw: unknown): ForecastHorizon {
  const n = Number(raw);
  return (FORECAST_HORIZONS as readonly number[]).includes(n) ? (n as ForecastHorizon) : 30;
}

export interface ForecastDTO extends Forecast {
  currency: string;
  horizon: ForecastHorizon;
  minimumMinor: number;
  fxMissing: number;
}

/** docs/04 §17 — balances per day per cash account and in total, from today's caches. */
export async function getForecast(ctx: Ctx, horizon: ForecastHorizon = 30): Promise<ForecastDTO> {
  await connectDb();
  const today = todayOf(ctx);
  const until = addDays(today, horizon - 1);
  const [accounts, toBase, settings, recurring, sips, emis, covered] = await Promise.all([
    AccountModel.find({ userId: uid(ctx), archivedAt: null }).lean<AccountDoc[]>(),
    loadToBase(ctx),
    getSettings(ctx),
    recurringUpcoming(ctx, until),
    sipUpcoming(ctx, until),
    debtUpcoming(ctx, until),
    debtIdsWithRules(ctx),
  ]);
  let fxMissing = 0;
  const base = (amount: number, currency: string, day: string) => {
    const v = toBase(amount, currency, day);
    if (v === null) fxMissing += 1;
    return v;
  };
  const tracked = accounts.filter((a) => FORECAST_TYPES.includes(a.type));
  const fAccounts = tracked.flatMap((a) => {
    const b = base(a.balanceMinor, a.currency, today);
    return b === null ? [] : [{ id: String(a._id), name: a.name, balanceMinor: b }];
  });
  const events: ForecastEvent[] = [];
  const push = (
    e: Omit<ForecastEvent, "deltaMinor">,
    amount: number,
    currency: string,
    sign: 1 | -1,
  ) => {
    const v = base(amount, currency, today);
    if (v !== null) events.push({ ...e, deltaMinor: sign * v });
  };
  for (const r of recurring) {
    const e = { date: r.dueDate, title: r.title, kind: "recurring" as const };
    if (r.ruleKind === "income")
      push({ ...e, accountId: r.toAccountId }, r.amountMinor, r.currency, 1);
    else push({ ...e, accountId: r.fromAccountId }, r.amountMinor, r.currency, -1);
    if (r.ruleKind === "transfer" && r.toAccountId) {
      push({ ...e, accountId: r.toAccountId }, r.amountMinor, r.currency, 1);
    }
  }
  for (const s of sips) {
    push(
      { date: s.dueDate, title: s.title, kind: "sip", accountId: s.accountId },
      s.amountMinor,
      s.currency,
      -1,
    );
  }
  for (const e of emis) {
    if (covered.has(e.href.replace("/debts/", ""))) continue;
    push(
      { date: e.dueDate, title: e.title, kind: "emi", accountId: e.accountId },
      e.amountMinor,
      e.currency,
      -1,
    );
  }
  for (const a of accounts) {
    if (a.type !== "credit_card" || !a.creditCard) continue;
    const due = nextMonthlyDate(today, a.creditCard.dueDay);
    const outstanding = cardOutstandingMinor(a.balanceMinor);
    if (due > until || outstanding === 0) continue;
    push(
      { date: due, title: `${a.name} payment`, kind: "card_due", accountId: null },
      outstanding,
      a.currency,
      -1,
    );
  }
  return {
    ...forecastBalances({
      today,
      horizonDays: horizon,
      accounts: fAccounts,
      events,
      minimumMinor: settings.minBalanceWarningMinor,
    }),
    currency: ctx.baseCurrency,
    horizon,
    minimumMinor: settings.minBalanceWarningMinor,
    fxMissing,
  };
}

// --------------------------------------------------------------------------------- projection

export interface ProjectionDTO {
  currency: string;
  startMinor: number;
  monthlyContributionMinor: number;
  annualReturnBp: number;
  points: ProjectionPoint[];
}

/**
 * docs/04 §22 — 10 years (5 and 10 highlighted), three scenarios. Phase 10 decisions: start = net
 * worth today; contribution = Σ active SIPs at today's stepped amount (future step-ups ignored).
 */
export async function getProjection(ctx: Ctx): Promise<ProjectionDTO> {
  await connectDb();
  const today = todayOf(ctx);
  const [input, plans, toBase, settings] = await Promise.all([
    loadSeriesInput(ctx),
    SipPlanModel.find({ userId: uid(ctx), status: "active" }).lean<SipPlanDoc[]>(),
    loadToBase(ctx),
    getSettings(ctx),
  ]);
  const now = computeNetWorthSeries(input, [today])[0]!;
  let monthly = 0;
  for (const p of plans) {
    const start = utcToBusinessDate(p.startDate, ctx.tz);
    const stepped = steppedAmount(p.amountMinor, p.currency, p.stepUp, start, today);
    monthly += toBase(monthlyEquivalent(stepped, p.frequency), p.currency, today) ?? 0;
  }
  return {
    currency: ctx.baseCurrency,
    startMinor: now.netWorthMinor,
    monthlyContributionMinor: monthly,
    annualReturnBp: settings.projectionReturnBp,
    points: projectNetWorth({
      startMinor: now.netWorthMinor,
      monthlyContributionMinor: monthly,
      annualReturnBp: settings.projectionReturnBp,
      years: 10,
    }),
  };
}

// ----------------------------------------------------------------------------------- insights

function quarterStart(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}

function monthsBack(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - (i + 1);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

/** Spend per top-level category (children rolled up). */
function rollUp(
  lines: { categoryId: string; amountMinor: number }[],
  byId: Map<string, CategoryDoc>,
) {
  const out = new Map<string, number>();
  for (const l of lines) {
    const c = byId.get(l.categoryId);
    const top = c?.parentId ? String(c.parentId) : l.categoryId;
    out.set(top, (out.get(top) ?? 0) + l.amountMinor);
  }
  return out;
}

/** docs/04 §22 — at most 5 deterministic insights. */
export async function getInsights(ctx: Ctx): Promise<Insight[]> {
  await connectDb();
  const today = todayOf(ctx);
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const prevMonthStart = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  const [
    categories,
    current,
    past,
    attention,
    budget,
    buckets,
    flows,
    emergency,
    upcoming,
    toBase,
  ] = await Promise.all([
    CategoryModel.find({ userId: uid(ctx) }).lean<CategoryDoc[]>(),
    spendLines(ctx, month),
    Promise.all(monthsBack(today, 3).map((mm) => spendLines(ctx, mm))),
    getAttention(ctx),
    getBudgetMonth(ctx, month),
    getBucketsInBase(ctx),
    completeMonthFlows(ctx, 3),
    getEmergency(ctx),
    getUpcoming(ctx, addDays(today, 30)),
    loadToBase(ctx),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const now = rollUp(current.lines, byId);
  const before = rollUp(
    past.flatMap((p) => p.lines),
    byId,
  );
  const quarterTxns = await TransactionModel.find({
    userId: uid(ctx),
    status: "posted",
    type: { $in: ["invest", "redeem", "transfer"] },
    date: { $gte: businessDateToUtc(quarterStart(today), ctx.tz) },
  }).lean<TransactionDoc[]>();
  let fees = 0;
  let invested = 0;
  for (const t of quarterTxns) {
    const day = utcToBusinessDate(t.date, ctx.tz);
    if (t.type !== "transfer") fees += toBase(t.feeMinor ?? 0, t.currency, day) ?? 0;
    if (t.type === "invest") invested += toBase(t.amountMinor, t.currency, day) ?? 0;
  }
  const missed = await SipExecutionModel.countDocuments({
    userId: uid(ctx),
    status: "missed",
    dueDate: { $gte: businessDateToUtc(prevMonthStart, ctx.tz) },
  });
  const avgExpense = Math.round(flows.reduce((s, p) => s + p.expenseMinor, 0) / 3);
  return computeInsights({
    dayOfMonth: Number(today.slice(8, 10)),
    categories: [...now.entries()].map(([categoryId, thisMonthMinor]) => ({
      categoryId,
      name: byId.get(categoryId)?.name ?? "Category",
      thisMonthMinor,
      avg3Minor: Math.round((before.get(categoryId) ?? 0) / 3),
    })),
    feesQuarterMinor: fees,
    investedQuarterMinor: invested,
    staleCount: attention.staleCount,
    fdMaturing30: upcoming
      .filter((u) => u.kind === "fd_maturity")
      .map((u) => ({
        holdingId: u.href.replace("/assets/", ""),
        name: u.title.replace(/ matures$/, ""),
        maturityDate: u.dueDate,
      })),
    budgets: budget.rows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      spentMinor: r.spentMinor,
      limitMinor: r.budgetMinor,
    })),
    freeCashMinor: buckets.freeMinor,
    avgMonthlyExpenseMinor: avgExpense,
    emergencyFull: emergency.tone === "green",
    offTargetCount: attention.offTargetCount,
    missedSipCount: missed,
    savingsRateBp: flows.at(-1)?.savingsRateBp ?? null,
    previousSavingsRateBp: flows.at(-2)?.savingsRateBp ?? null,
  });
}
