import "server-only";
import { cache } from "react";
import { z } from "zod";
import { businessDateToUtc, utcToBusinessDate } from "@/domain/dates";
import { dedicatedBucket } from "@/domain/earmarks";
import {
  coverageTenths,
  emergencyProgress,
  emergencyTarget,
  healthScore,
  lifeCoverTarget,
  type EmergencyBasis,
  type HealthScore,
  type ProgressTone,
} from "@/domain/essentials";
import { fdValue } from "@/domain/fd";
import { dateKey } from "@/modules/accounts/schemas";
import { AccountModel, type AccountDoc } from "@/modules/accounts/model";
import { spendLinesBetween } from "@/modules/budgets/service";
import { CategoryModel, type CategoryDoc } from "@/modules/categories/model";
import { completeMonthFlows } from "@/modules/dashboard/queries";
import { listDebts } from "@/modules/debts/service";
import {
  effectiveEarmarksOf,
  listAccountBuckets,
  storeBucketAmounts,
} from "@/modules/earmarks/service";
import {
  InsurancePolicyModel,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  type InsurancePolicyDoc,
  type PolicyType,
  type PremiumFrequency,
} from "@/modules/essentials/model";
import { loadToBase } from "@/modules/fx/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { getSettings } from "@/modules/settings/service";
import { parseInput } from "@/server/action-result";
import type { Ctx } from "@/server/ctx";
import { connectDb } from "@/server/db/connect";
import { toObjectId } from "@/server/db/ids";
import { withTransaction } from "@/server/db/transaction";
import { AppError } from "@/server/errors";
import { fdTerms } from "@/server/ledger/holding-events";
import { postTransaction } from "@/server/ledger/post";

// docs/04 §13 — Essentials: emergency fund (MOD-1 basis settings), insurance check, debt-to-income,
// savings rate and the health score. Phase 10 decisions: DTI = Σ EMIs ÷ average monthly income of
// the last 3 complete months; savings rate for the score = last 3 complete months; policies are in
// base currency.

const uid = (ctx: Ctx) => toObjectId(ctx.userId, "User");
const todayOf = (ctx: Ctx) => utcToBusinessDate(new Date(), ctx.tz);
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const money = z
  .number({ error: "Enter an amount" })
  .int("Whole amount")
  .max(Number.MAX_SAFE_INTEGER);

// ------------------------------------------------------------------------------ insurance CRUD

export const policyInputSchema = z
  .object({
    type: z.enum(POLICY_TYPES),
    provider: z.string().trim().min(1, "Enter the provider").max(80),
    policyNumberLast4: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,4}$/, "Up to 4 letters or digits")
      .nullish()
      .or(z.literal("").transform(() => null)),
    coverMinor: money.min(0, "Cannot be negative"),
    premiumMinor: money.min(0, "Cannot be negative"),
    premiumFrequency: z.enum(PREMIUM_FREQUENCIES),
    startDate: dateKey,
    renewalDate: dateKey,
    nominee: z.string().trim().max(80).nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((v) => v.renewalDate >= v.startDate, {
    path: ["renewalDate"],
    message: "Renewal is on or after the start date",
  });
export type PolicyInput = z.input<typeof policyInputSchema>;

export interface PolicyDTO {
  id: string;
  type: PolicyType;
  provider: string;
  policyNumberLast4: string | null;
  coverMinor: number;
  premiumMinor: number;
  premiumFrequency: PremiumFrequency;
  /** Premium per year (monthly × 12, quarterly × 4). */
  annualPremiumMinor: number;
  startDate: string;
  renewalDate: string;
  daysToRenewal: number;
  nominee: string | null;
  notes: string | null;
  status: "active" | "lapsed";
}

const PER_YEAR: Record<PremiumFrequency, number> = { monthly: 12, quarterly: 4, yearly: 1 };
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function toPolicyDTO(p: InsurancePolicyDoc, today: string): PolicyDTO {
  return {
    id: String(p._id),
    type: p.type,
    provider: p.provider,
    policyNumberLast4: p.policyNumberLast4 ?? null,
    coverMinor: p.coverMinor,
    premiumMinor: p.premiumMinor,
    premiumFrequency: p.premiumFrequency,
    annualPremiumMinor: p.premiumMinor * PER_YEAR[p.premiumFrequency],
    startDate: p.startDate,
    renewalDate: p.renewalDate,
    daysToRenewal: dayDiff(today, p.renewalDate),
    nominee: p.nominee ?? null,
    notes: p.notes ?? null,
    status: p.status,
  };
}

export async function createPolicy(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(policyInputSchema, input);
  await connectDb();
  const doc = await InsurancePolicyModel.create({
    ...data,
    policyNumberLast4: data.policyNumberLast4 ?? null,
    nominee: data.nominee || null,
    notes: data.notes || null,
    userId: uid(ctx),
  });
  return { id: String(doc._id) };
}

export async function updatePolicy(ctx: Ctx, id: string, input: unknown): Promise<{ id: string }> {
  const data = parseInput(policyInputSchema, input);
  await connectDb();
  const res = await InsurancePolicyModel.updateOne(
    { _id: toObjectId(id, "Policy"), userId: uid(ctx) },
    {
      $set: {
        ...data,
        policyNumberLast4: data.policyNumberLast4 ?? null,
        nominee: data.nominee || null,
        notes: data.notes || null,
      },
    },
    { runValidators: true },
  );
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND", "Policy not found");
  return { id };
}

export async function setPolicyStatus(
  ctx: Ctx,
  id: string,
  status: unknown,
): Promise<{ id: string }> {
  const s = parseInput(z.enum(["active", "lapsed"]), status);
  await connectDb();
  const res = await InsurancePolicyModel.updateOne(
    { _id: toObjectId(id, "Policy"), userId: uid(ctx) },
    { $set: { status: s } },
  );
  if (res.matchedCount === 0) throw new AppError("NOT_FOUND", "Policy not found");
  return { id };
}

/** Policies are not financial records (no ledger postings), so they can be deleted. */
export async function deletePolicy(ctx: Ctx, id: string): Promise<{ id: string }> {
  await connectDb();
  const res = await InsurancePolicyModel.deleteOne({
    _id: toObjectId(id, "Policy"),
    userId: uid(ctx),
  });
  if (res.deletedCount === 0) throw new AppError("NOT_FOUND", "Policy not found");
  return { id };
}

export async function listPolicies(ctx: Ctx): Promise<PolicyDTO[]> {
  await connectDb();
  const today = todayOf(ctx);
  const docs = await InsurancePolicyModel.find({ userId: uid(ctx) })
    .sort({ status: 1, renewalDate: 1 })
    .lean<InsurancePolicyDoc[]>();
  return docs.map((d) => toPolicyDTO(d, today));
}

// ------------------------------------------------------------------------------ emergency fund

export interface EmergencySource {
  kind: "earmark" | "account" | "holding";
  id: string;
  name: string;
  currency: string;
  /** In the item's currency. */
  valueMinor: number;
  /** In base; null when no FX rate. */
  baseMinor: number | null;
  /** Accounts and high-liquidity holdings are available immediately; other holdings are locked. */
  available: boolean;
  href: string;
}

export interface EmergencyDTO {
  basis: EmergencyBasis;
  basisUsed: EmergencyBasis;
  months: number;
  monthlyBasisMinor: number;
  averageEssentialMinor: number;
  averageAllMinor: number;
  targetMinor: number;
  targetSource: "override" | "basis";
  currentMinor: number;
  availableMinor: number;
  lockedMinor: number;
  progressBp: number;
  tone: ProgressTone;
  coverageTenths: number | null;
  sources: EmergencySource[];
  fxMissing: number;
}

function holdingValueToday(h: HoldingDoc, tz: string, today: string): number {
  const terms = fdTerms(h, tz);
  return terms ? fdValue(terms, today) : h.currentValueMinor;
}

/** Average monthly expense (all, essential) over the last 6 complete months, base currency. */
async function expenseAverages(ctx: Ctx): Promise<{ all: number; essential: number }> {
  const today = todayOf(ctx);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthKey = (offset: number) => {
    const t = y * 12 + (m - 1) - offset;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };
  // One query over the 6 complete months (this month excluded).
  const [categories, { lines }] = await Promise.all([
    CategoryModel.find({ userId: uid(ctx) }).lean<CategoryDoc[]>(),
    spendLinesBetween(ctx, monthKey(6), monthKey(0)),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const essential = (id: string) => {
    const c = byId.get(id);
    if (!c) return false;
    if (c.isEssential) return true;
    return c.parentId ? Boolean(byId.get(String(c.parentId))?.isEssential) : false;
  };
  let all = 0;
  let ess = 0;
  for (const l of lines) {
    all += l.amountMinor;
    if (essential(l.categoryId)) ess += l.amountMinor;
  }
  return { all: Math.round(all / 6), essential: Math.round(ess / 6) };
}

/** docs/04 §13 + Phase 10: target, current (emergency bucket §20), available vs locked, sources. */
export async function getEmergency(ctx: Ctx): Promise<EmergencyDTO> {
  await connectDb();
  const today = todayOf(ctx);
  const [settings, averages, buckets, accounts, holdings, toBase] = await Promise.all([
    getSettings(ctx),
    expenseAverages(ctx),
    listAccountBuckets(ctx),
    AccountModel.find({ userId: uid(ctx), archivedAt: null }).lean<AccountDoc[]>(),
    HoldingModel.find({ userId: uid(ctx), status: "active", countsTowardEmergencyFund: true }).lean<
      HoldingDoc[]
    >(),
    loadToBase(ctx),
  ]);
  const sources: EmergencySource[] = [];
  for (const a of accounts) {
    const b = buckets.get(String(a._id));
    if (!b || b.emergencyMinor <= 0) continue;
    sources.push({
      kind: dedicatedBucket(a) === "emergency" ? "account" : "earmark",
      id: String(a._id),
      name: a.name,
      currency: a.currency,
      valueMinor: b.emergencyMinor,
      baseMinor: toBase(b.emergencyMinor, a.currency, today),
      available: true,
      href: `/accounts/${String(a._id)}`,
    });
  }
  for (const h of holdings) {
    const v = holdingValueToday(h, ctx.tz, today);
    if (v <= 0) continue;
    sources.push({
      kind: "holding",
      id: String(h._id),
      name: h.name,
      currency: h.currency,
      valueMinor: v,
      baseMinor: toBase(v, h.currency, today),
      available: h.liquidity === "high",
      href: `/assets/${String(h._id)}`,
    });
  }
  const { listHoldingBuckets } = await import("@/modules/earmarks/holding-service");
  for (const hb of (await listHoldingBuckets(ctx)).values()) {
    if (!hb.canCarryEarmarks || hb.emergencyMinor <= 0) continue;
    sources.push({
      kind: "holding",
      id: hb.holdingId,
      name: `${hb.name} (emergency part)`,
      currency: hb.currency,
      valueMinor: hb.emergencyMinor,
      baseMinor: toBase(hb.emergencyMinor, hb.currency, today),
      available: hb.liquidity === "high",
      href: `/assets/${hb.holdingId}`,
    });
  }
  sources.sort((a, b) => (b.baseMinor ?? 0) - (a.baseMinor ?? 0));
  const available = sources.filter((s) => s.available).reduce((s, x) => s + (x.baseMinor ?? 0), 0);
  const locked = sources.filter((s) => !s.available).reduce((s, x) => s + (x.baseMinor ?? 0), 0);
  const current = available + locked;
  const target = emergencyTarget({
    months: settings.emergencyMonths,
    basis: settings.emergencyExpenseBasis,
    manualMonthlyMinor: settings.emergencyManualMonthlyMinor,
    averageEssentialMinor: averages.essential,
    averageAllMinor: averages.all,
    overrideMinor: settings.emergencyTargetOverrideMinor,
  });
  return {
    basis: settings.emergencyExpenseBasis,
    basisUsed: target.basisUsed,
    months: settings.emergencyMonths,
    monthlyBasisMinor: target.monthlyBasisMinor,
    averageEssentialMinor: averages.essential,
    averageAllMinor: averages.all,
    targetMinor: target.targetMinor,
    targetSource: settings.emergencyTargetOverrideMinor !== null ? "override" : "basis",
    currentMinor: current,
    availableMinor: available,
    lockedMinor: locked,
    ...emergencyProgress(current, target.targetMinor),
    coverageTenths: coverageTenths(current, target.monthlyBasisMinor),
    sources,
    fxMissing: sources.filter((s) => s.baseMinor === null).length,
  };
}

// ---------------------------------------------------------------------------------- essentials

export interface EssentialsDTO {
  currency: string;
  todayKey: string;
  emergency: EmergencyDTO;
  insurance: {
    policies: PolicyDTO[];
    lifeCoverMinor: number;
    lifeTargetMinor: number;
    healthCoverMinor: number;
    healthTargetMinor: number | null;
    annualIncomeMinor: number;
    lifeCoverIncomeMultiple: number;
    annualPremiumMinor: number;
  };
  debt: { dtiBp: number | null; monthlyEmiMinor: number; avgMonthlyIncomeMinor: number };
  savings: {
    /** Last 3 complete months (score input). */
    rateBp: number | null;
    trend: {
      month: string;
      savingsRateBp: number | null;
      incomeMinor: number;
      expenseMinor: number;
    }[];
  };
  score: HealthScore;
}

/** Everything on /essentials (cached per request: the dashboard and standing reuse it). */
export const getEssentials = cache(async (ctx: Ctx): Promise<EssentialsDTO> => {
  const today = todayOf(ctx);
  const [settings, emergency, policies, debts, flows] = await Promise.all([
    getSettings(ctx),
    getEmergency(ctx),
    listPolicies(ctx),
    listDebts(ctx),
    completeMonthFlows(ctx, 12),
  ]);
  const active = policies.filter((p) => p.status === "active");
  const cover = (types: PolicyType[]) =>
    active.filter((p) => types.includes(p.type)).reduce((s, p) => s + p.coverMinor, 0);
  const annualIncome = flows.reduce((s, p) => s + p.incomeMinor, 0);
  const last3 = flows.slice(-3);
  const income3 = last3.reduce((s, p) => s + p.incomeMinor, 0);
  const expense3 = last3.reduce((s, p) => s + p.expenseMinor, 0);
  const rateBp = income3 > 0 ? Math.round(((income3 - expense3) * 10_000) / income3) : null;
  const lifeTarget = lifeCoverTarget(annualIncome, settings.lifeCoverIncomeMultiple);
  const insurance = {
    policies,
    lifeCoverMinor: cover(["life"]),
    lifeTargetMinor: lifeTarget,
    healthCoverMinor: cover(["health"]),
    healthTargetMinor: settings.healthCoverTargetMinor,
    annualIncomeMinor: annualIncome,
    lifeCoverIncomeMultiple: settings.lifeCoverIncomeMultiple,
    annualPremiumMinor: active.reduce((s, p) => s + p.annualPremiumMinor, 0),
  };
  const debt = {
    dtiBp: debts.dtiBp,
    monthlyEmiMinor: debts.totals.monthlyEmiMinor,
    avgMonthlyIncomeMinor: debts.avgMonthlyIncomeMinor,
  };
  return {
    currency: ctx.baseCurrency,
    todayKey: today,
    emergency,
    insurance,
    debt,
    savings: {
      rateBp,
      trend: flows.map((p) => ({
        month: p.key.slice(0, 7),
        savingsRateBp: p.savingsRateBp,
        incomeMinor: p.incomeMinor,
        expenseMinor: p.expenseMinor,
      })),
    },
    score: healthScore({
      emergencyCurrentMinor: emergency.currentMinor,
      emergencyTargetMinor: emergency.targetMinor,
      lifeCoverMinor: insurance.lifeCoverMinor,
      lifeTargetMinor: lifeTarget,
      healthCoverMinor: insurance.healthCoverMinor,
      healthTargetMinor: settings.healthCoverTargetMinor,
      dtiBp: debt.dtiBp,
      hasDebtPayments: debt.monthlyEmiMinor > 0,
      savingsRateBp: rateBp,
    }),
  };
});

// --------------------------------------------------------------------------- use emergency fund

export const useEmergencySchema = z
  .object({
    accountId: objectId,
    kind: z.enum(["expense", "transfer"]),
    amountMinor: money.positive("Above zero"),
    date: dateKey,
    categoryId: objectId.nullish(),
    toAccountId: objectId.nullish(),
    description: z.string().trim().max(120).nullish(),
  })
  .strict()
  .refine((v) => v.kind !== "expense" || Boolean(v.categoryId), {
    path: ["categoryId"],
    message: "Choose a category",
  })
  .refine((v) => v.kind !== "transfer" || Boolean(v.toAccountId), {
    path: ["toAccountId"],
    message: "Choose an account",
  })
  .refine((v) => v.toAccountId !== v.accountId, {
    path: ["toAccountId"],
    message: "Choose a different account",
  });
export type UseEmergencyInput = z.input<typeof useEmergencySchema>;

export const EMERGENCY_USE_LABEL = "Emergency fund use";

/**
 * "Use emergency fund" (Phase 10): an expense or transfer paid with emergency money. On an
 * earmarked account the emergency earmark is reduced by the amount first (opportunity and free
 * cash untouched), then the outflow posts — one DB transaction. On an emergency-flagged account
 * the withdrawal is confirmed. Labelled "Emergency fund use" and tagged `emergency-fund`.
 */
export async function useEmergencyFund(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const data = parseInput(useEmergencySchema, input);
  return withTransaction(async (session) => {
    const account = await AccountModel.findOne({
      _id: toObjectId(data.accountId, "Account"),
      userId: uid(ctx),
    })
      .session(session)
      .lean<AccountDoc>();
    if (!account || account.archivedAt) throw new AppError("NOT_FOUND", "Account not found");
    if (dedicatedBucket(account) === "emergency") {
      if (data.amountMinor > Math.max(0, account.balanceMinor)) {
        throw new AppError("VALIDATION", "More than the account holds", {
          amountMinor: [`At most ${account.balanceMinor}`],
        });
      }
    } else {
      const eff = await effectiveEarmarksOf(account, session);
      if (eff.emergencyMinor <= 0) {
        throw new AppError("VALIDATION", `"${account.name}" has no emergency money`);
      }
      if (data.amountMinor > eff.emergencyMinor) {
        throw new AppError("VALIDATION", "More than the emergency earmark", {
          amountMinor: [`At most ${eff.emergencyMinor} is emergency money on this account`],
        });
      }
      await storeBucketAmounts(
        ctx,
        account,
        { emergencyMinor: eff.emergencyMinor - data.amountMinor, opportunityMinor: null },
        "emergency_use",
        session,
      );
    }
    const common = {
      date: businessDateToUtc(data.date, ctx.tz),
      amountMinor: data.amountMinor,
      fromAccountId: data.accountId,
      description: data.description || EMERGENCY_USE_LABEL,
      notes: EMERGENCY_USE_LABEL,
      tags: ["emergency-fund"],
      confirmEmergency: true,
    };
    const txn = await postTransaction(
      ctx,
      data.kind === "expense"
        ? { ...common, type: "expense", categoryId: data.categoryId! }
        : { ...common, type: "transfer", toAccountId: data.toAccountId!, feeMinor: 0 },
      session,
    );
    return { id: String(txn._id) };
  });
}
