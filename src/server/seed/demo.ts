import "server-only";
import type { mongo } from "mongoose";
import { addDays, addMonths, addYears, endOfMonth, format, parse } from "date-fns";
import { createAccount } from "@/modules/accounts/service";
import { AccountModel } from "@/modules/accounts/model";
import { saveTarget } from "@/modules/allocation/service";
import { AssetClassModel } from "@/modules/asset-classes/model";
import { setBudget } from "@/modules/budgets/service";
import { CategoryModel, type CategoryDoc, type CategoryKind } from "@/modules/categories/model";
import { createCategoryRule } from "@/modules/categories/rules-service";
import { createDebt, recordPayment } from "@/modules/debts/service";
import { DebtModel, type DebtDoc } from "@/modules/debts/model";
import { setEarmark } from "@/modules/earmarks/service";
import { setHoldingEarmark } from "@/modules/earmarks/holding-service";
import { createPolicy } from "@/modules/essentials/service";
import { saveFxRate } from "@/modules/fx/service";
import { createGoal } from "@/modules/goals/service";
import { HoldingModel, type HoldingDoc } from "@/modules/holdings/model";
import { createHolding, recordValuation } from "@/modules/holdings/service";
import {
  addMarketLevel,
  recordDeployment,
  saveFundSettings,
} from "@/modules/opportunity-fund/service";
import { createRule } from "@/modules/recurring/service";
import { ensureMonthlyReview } from "@/modules/reports/service";
import { SipExecutionModel, type SipExecutionDoc } from "@/modules/sip/model";
import { createPlan, executeSip, skipSip } from "@/modules/sip/service";
import { rebuildHistory } from "@/modules/snapshots/service";
import { createTransaction } from "@/modules/transactions/service";
import type { TransactionInput } from "@/modules/transactions/schemas";
import { runNotifications } from "@/server/cron/jobs/daily";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";

// Realistic demo data for ONE existing user (Phase 12: 18 months across every module). Everything
// goes through the services, so balances, holdings, earmarks, SIP periods, loans and snapshots stay
// consistent with the ledger. Deterministic (seeded random numbers).

export const DEMO_MONTHS = 18;
const KEY = "yyyy-MM-dd";
const toDate = (k: string) => parse(k, KEY, new Date(2000, 0, 1));
const key = (d: Date) => format(d, KEY);

/** Deterministic pseudo-random numbers (mulberry32), so a re-seed gives the same data. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The Better Auth user id for an email (auth_users), or null. */
export async function findUserIdByEmail(db: mongo.Db, email: string): Promise<string | null> {
  const user = await db
    .collection("auth_users")
    .findOne({ email: email.trim().toLowerCase() }, { projection: { _id: 1 } });
  return user ? String(user._id) : null;
}

export async function accountCount(ctx: Ctx): Promise<number> {
  return AccountModel.countDocuments({ userId: toObjectId(ctx.userId, "User") });
}

export interface SeedSummary {
  accounts: number;
  transactions: number;
  holdings: number;
  months: number;
  sipExecutions: number;
  notifications: number;
}

/** Seeds 18 months of history ending today (business dates in the user's timezone). */
export async function seedDemoData(ctx: Ctx, todayKey: string): Promise<SeedSummary> {
  const userId = toObjectId(ctx.userId, "User");
  const today = toDate(todayKey);
  const start = addMonths(new Date(today.getFullYear(), today.getMonth(), 1), -DEMO_MONTHS);
  const startKey = key(start);
  const rand = rng(20_261_018);
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  let txns = 0;

  const categories = await CategoryModel.find({ userId, archivedAt: null }).lean<CategoryDoc[]>();
  const cat = (name: string, kind: CategoryKind) =>
    String(
      (categories.find((c) => c.name === name && c.kind === kind) ??
        categories.find((c) => c.name === "Uncategorised" && c.kind === kind))!._id,
    );
  const classId = async (name: string) =>
    String((await AssetClassModel.findOne({ userId, name }).lean())!._id);

  // ---- FX: monthly USD → base rates from the start
  for (let m = 0; m <= DEMO_MONTHS; m++) {
    const d = key(addMonths(start, m));
    if (d > todayKey) break;
    await saveFxRate(ctx, { date: d, base: "USD", quote: ctx.baseCurrency, rate: 296 + m * 0.6 });
  }

  // ---- Accounts
  const acct = (input: Parameters<typeof createAccount>[1]) =>
    createAccount(ctx, { openingDate: startKey, ...(input as object) });
  const bank = await acct({
    name: "Commercial Bank Savings",
    type: "bank",
    currency: ctx.baseCurrency,
    institution: "Commercial Bank",
    openingBalanceMinor: 1_200_000_00,
  });
  const current = await acct({
    name: "Sampath Current",
    type: "bank",
    currency: ctx.baseCurrency,
    institution: "Sampath Bank",
    openingBalanceMinor: 120_000_00,
  });
  const cash = await acct({
    name: "Cash wallet",
    type: "cash",
    currency: ctx.baseCurrency,
    openingBalanceMinor: 25_000_00,
  });
  const card = await acct({
    name: "HNB Visa",
    type: "credit_card",
    currency: ctx.baseCurrency,
    institution: "HNB",
    openingBalanceMinor: 0,
    creditCard: { limitMinor: 500_000_00, statementDay: 20, dueDay: 5 },
  });
  await acct({
    name: "Emergency fund (NSB)",
    type: "bank",
    currency: ctx.baseCurrency,
    institution: "NSB",
    openingBalanceMinor: 600_000_00,
    countsTowardEmergencyFund: true,
  });
  const opp = await acct({
    name: "Opportunity fund",
    type: "opportunity_fund",
    currency: ctx.baseCurrency,
    openingBalanceMinor: 400_000_00,
  });
  const usd = await acct({
    name: "USD wallet (Wise)",
    type: "wallet",
    currency: "USD",
    institution: "Wise",
    openingBalanceMinor: 1_200_00,
  });
  const broker = await acct({
    name: "CAL broker cash",
    type: "broker_cash",
    currency: ctx.baseCurrency,
    institution: "CAL",
    openingBalanceMinor: 50_000_00,
  });
  await acct({
    name: "Loan to Kasun",
    type: "receivable",
    currency: ctx.baseCurrency,
    counterparty: "Kasun",
    openingBalanceMinor: 75_000_00,
  });

  const post = async (input: TransactionInput) => {
    if (input.date > todayKey) return;
    await createTransaction(ctx, input);
    txns += 1;
  };

  // ---- Holdings (opening values on the start date)
  const equity = await classId("Equity");
  const fixedIncome = await classId("Fixed Income");
  const goldClass = await classId("Gold");
  const fund = await createHolding(ctx, {
    name: "CAL Balanced Fund",
    assetClassId: equity,
    instrumentType: "unit_trust",
    currency: ctx.baseCurrency,
    platform: "CAL",
    liquidity: "high",
    openingDate: startKey,
    investedMinor: 400_000_00,
    currentValueMinor: 412_000_00,
  });
  const stock = await createHolding(ctx, {
    name: "John Keells Holdings",
    symbol: "JKH.N0000",
    assetClassId: equity,
    instrumentType: "stock",
    currency: ctx.baseCurrency,
    platform: "CAL",
    openingDate: startKey,
    investedMinor: 180_000_00,
    currentValueMinor: 171_500_00,
  });
  const moneyMarket = await createHolding(ctx, {
    name: "CAL Money Market Fund",
    assetClassId: fixedIncome,
    instrumentType: "money_market",
    currency: ctx.baseCurrency,
    platform: "CAL",
    liquidity: "high",
    openingDate: startKey,
    investedMinor: 200_000_00,
    currentValueMinor: 200_000_00,
  });
  const gold = await createHolding(ctx, {
    name: "Gold sovereigns",
    assetClassId: goldClass,
    instrumentType: "gold",
    currency: ctx.baseCurrency,
    liquidity: "low",
    openingDate: startKey,
    investedMinor: 250_000_00,
    currentValueMinor: 262_000_00,
  });
  const etf = await createHolding(ctx, {
    name: "Vanguard S&P 500 ETF",
    symbol: "VOO",
    assetClassId: equity,
    instrumentType: "etf",
    currency: "USD",
    platform: "Interactive Brokers",
    liquidity: "high",
    openingDate: startKey,
    investedMinor: 2_000_00,
    currentValueMinor: 2_080_00,
  });
  await createHolding(ctx, {
    name: "NSB Fixed Deposit",
    assetClassId: fixedIncome,
    instrumentType: "fd",
    currency: ctx.baseCurrency,
    platform: "NSB",
    fd: {
      principalMinor: 1_000_000_00,
      rateBp: 1_100,
      startDate: key(addMonths(start, 8)),
      maturityDate: key(addMonths(start, 20)),
      compounding: "monthly",
      payout: "at_maturity",
    },
  });

  // ---- Target allocation and a monthly SIP that follows it
  await saveTarget(ctx, {
    allocation: [
      {
        assetClassId: equity,
        percentBp: 6_000,
        assets: [
          { holdingId: fund.id, percentBp: 7_000 },
          { holdingId: stock.id, percentBp: 3_000 },
        ],
      },
      {
        assetClassId: fixedIncome,
        percentBp: 2_500,
        assets: [{ holdingId: moneyMarket.id, percentBp: 10_000 }],
      },
      {
        assetClassId: goldClass,
        percentBp: 1_500,
        assets: [{ holdingId: gold.id, percentBp: 10_000 }],
      },
    ],
    thresholdBp: 500,
    note: "Starting plan",
  });
  const sipStart = key(addDays(start, 9));
  const { plan } = await createPlan(ctx, {
    name: "Core monthly SIP",
    amountMinor: 50_000_00,
    frequency: "monthly",
    dayOfMonth: 10,
    sourceAccountId: bank.id,
    startDate: sipStart,
    stepUp: { percentBp: 1_000, everyMonths: 12 },
    missedPolicy: "skip",
    graceDays: 7,
    allocationSource: "target",
  });
  const executions = (
    await SipExecutionModel.find({ userId, planId: toObjectId(plan.id, "Plan") })
      .sort({ dueDate: 1 })
      .lean<SipExecutionDoc[]>()
  ).filter((e) => key(e.dueDate) < todayKey);
  const skipIndex = 5;
  const missIndex = 11;
  let sipDone = 0;

  // ---- Opportunity Fund: ASPI with a mid-period dip
  await saveFundSettings(ctx, {
    benchmarkName: "ASPI",
    targetSizeMinor: 600_000_00,
    rules: [
      { drawdownBp: 1_000, deployPercentBp: 2_500 },
      { drawdownBp: 2_000, deployPercentBp: 5_000 },
    ],
    allocationSource: "target",
    allocation: null,
    defaultSourceAccountId: opp.id,
  });
  const aspi = (m: number) => {
    // Rises, dips ~13% around month 10, then recovers.
    const base = 11_000 + m * 180;
    return m >= 9 && m <= 11 ? base * (m === 10 ? 0.87 : 0.93) : base;
  };

  // ---- A car lease (tracked from its 7th instalment), paid by a recurring rule's account
  const { id: debtId } = await createDebt(ctx, {
    name: "Toyota Aqua lease",
    kind: "leasing",
    lender: "LB Finance",
    principalMinor: 2_500_000_00,
    annualRateBp: 1_400,
    tenureMonths: 60,
    startDate: key(addMonths(start, -6)),
    paymentDay: 15,
    paymentAccountId: bank.id,
    paidBeforeTracking: 6,
  });
  const debt = (await DebtModel.findOne({
    userId,
    _id: toObjectId(debtId, "Debt"),
  }).lean<DebtDoc>())!;

  // ---- Monthly everyday money, investing and valuations
  let cardSpendLastMonth = 0;
  for (let m = 0; m <= DEMO_MONTHS; m++) {
    const monthStart = addMonths(start, m);
    const day = (d: number) => key(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
    let cardSpend = 0;
    const onCard = async (input: Omit<TransactionInput & { type: "expense" }, "fromAccountId">) => {
      await post({ ...input, fromAccountId: card.id } as TransactionInput);
      if (input.date <= todayKey) cardSpend += input.amountMinor;
    };

    await post({
      type: "income",
      date: day(25),
      amountMinor: m >= 12 ? 450_000_00 : 420_000_00,
      toAccountId: bank.id,
      categoryId: cat("Salary", "income"),
      description: "Salary",
      counterparty: "Employer",
    });
    if (m % 4 === 2) {
      await post({
        type: "income",
        date: day(19),
        amountMinor: between(40_000_00, 90_000_00),
        toAccountId: current.id,
        categoryId: cat("Business", "income"),
        description: "Freelance design work",
      });
    }
    await post({
      type: "expense",
      date: day(3),
      amountMinor: 85_000_00,
      fromAccountId: bank.id,
      categoryId: cat("Rent", "expense"),
      description: "House rent",
      counterparty: "Landlord",
    });
    await post({
      type: "expense",
      date: day(8),
      amountMinor: between(9_500_00, 14_500_00),
      fromAccountId: current.id,
      categoryId: cat("Utilities", "expense"),
      description: "Electricity & water",
      counterparty: "CEB",
    });
    await post({
      type: "expense",
      date: day(12),
      amountMinor: 4_990_00,
      fromAccountId: current.id,
      categoryId: cat("Utilities", "expense"),
      description: "Fibre internet",
      counterparty: "SLT",
    });
    for (const d of [2, 9, 16, 23]) {
      const amount = between(6_000_00, 14_000_00);
      const input = {
        type: "expense" as const,
        date: day(d),
        amountMinor: amount,
        categoryId: cat("Groceries", "expense"),
        description: "Weekly groceries",
        counterparty: "Keells",
      };
      if (d % 2 === 0) await onCard(input);
      else await post({ ...input, fromAccountId: current.id });
    }
    for (const d of [6, 20]) {
      await onCard({
        type: "expense",
        date: day(d),
        amountMinor: between(3_000_00, 9_000_00),
        categoryId: cat("Restaurants", "expense"),
        description: "Dinner out",
      });
    }
    // Small cash spending every few days
    for (const d of [1, 4, 7, 10, 13, 17, 21, 24, 28]) {
      await post({
        type: "expense",
        date: day(d),
        amountMinor: between(450_00, 1_800_00),
        fromAccountId: cash.id,
        categoryId: cat(d % 2 ? "Restaurants" : "Groceries", "expense"),
        description: d % 2 ? "Lunch" : "Bakery & vegetables",
      });
    }
    await post({
      type: "expense",
      date: day(14),
      amountMinor: between(8_000_00, 12_000_00),
      fromAccountId: cash.id,
      categoryId: cat("Fuel", "expense"),
      description: "Fuel",
      counterparty: "Ceypetco",
    });
    await post({
      type: "expense",
      date: day(18),
      amountMinor: between(1_500_00, 4_000_00),
      fromAccountId: cash.id,
      categoryId: cat("Taxi & ride", "expense"),
      description: "PickMe rides",
    });
    if (m % 2 === 0) {
      const amount = between(12_000_00, 30_000_00);
      await post({
        type: "expense",
        date: day(15),
        amountMinor: amount,
        fromAccountId: card.id,
        splits: [
          { categoryId: cat("Shopping", "expense"), amountMinor: Math.round(amount * 0.7) },
          {
            categoryId: cat("Personal care", "expense"),
            amountMinor: amount - Math.round(amount * 0.7),
          },
        ],
        description: "Odel shopping",
        tags: ["clothes"],
      });
      if (day(15) <= todayKey) cardSpend += amount;
    }
    if (m % 3 === 1) {
      await post({
        type: "expense",
        date: day(11),
        amountMinor: between(5_000_00, 15_000_00),
        fromAccountId: current.id,
        categoryId: cat("Health", "expense"),
        description: "Doctor & pharmacy",
      });
    }
    await post({
      type: "expense",
      date: day(27),
      amountMinor: between(2_000_00, 6_000_00),
      fromAccountId: current.id,
      categoryId: cat("Entertainment", "expense"),
      description: "Movies & streaming",
    });
    if (m === 7) {
      await post({
        type: "expense",
        date: day(9),
        amountMinor: 180_000_00,
        fromAccountId: bank.id,
        categoryId: cat("Entertainment", "expense"),
        description: "Family trip to Ella",
        tags: ["holiday"],
      });
    }

    // Pay last month's card bill and fund the spending accounts
    if (cardSpendLastMonth > 0) {
      await post({
        type: "transfer",
        date: day(5),
        amountMinor: cardSpendLastMonth,
        fromAccountId: bank.id,
        toAccountId: card.id,
        description: "Card payment",
      });
    }
    await post({
      type: "transfer",
      date: day(26),
      amountMinor: 60_000_00,
      fromAccountId: bank.id,
      toAccountId: current.id,
      feeMinor: m % 6 === 2 ? 50_00 : 0,
      description: "Monthly spending money",
    });
    await post({
      type: "transfer",
      date: day(26),
      amountMinor: 30_000_00,
      fromAccountId: bank.id,
      toAccountId: cash.id,
      description: "ATM withdrawal",
    });
    if (m % 3 === 0) {
      await post({
        type: "transfer",
        date: day(27),
        amountMinor: 30_000_00,
        fromAccountId: bank.id,
        toAccountId: opp.id,
        description: "Top up the opportunity fund",
      });
    }

    // Lease instalment
    if (day(15) <= todayKey) {
      await recordPayment(ctx, debtId, {
        date: day(15),
        amountMinor: debt.emiMinor,
        fromAccountId: bank.id,
      });
      txns += 1;
    }

    // SIP period of this month: executed on time, except one skipped and one left missed
    const e = executions[m];
    if (e) {
      if (m === skipIndex) {
        await skipSip(ctx, String(e._id), { reason: "School fees this month" });
      } else if (m !== missIndex) {
        const fresh = (await SipExecutionModel.findOne({
          userId,
          _id: e._id,
        }).lean<SipExecutionDoc>())!;
        await executeSip(ctx, String(e._id), {
          executedOn: key(fresh.dueDate) > todayKey ? todayKey : format(fresh.dueDate, KEY),
          lines: fresh.lines.map((l) => ({
            holdingId: l.holdingId ? String(l.holdingId) : null,
            actualMinor: l.plannedMinor,
            feeMinor: 0,
          })),
        });
        sipDone += 1;
      }
    }

    // Dividends, ASPI level, opportunity deployment during the dip
    if (m % 3 === 2) {
      await post({
        type: "investment_income",
        date: day(22),
        amountMinor: 4_500_00,
        taxMinor: 675_00,
        toAccountId: broker.id,
        holdingId: stock.id,
        incomeKind: "dividend",
        reinvest: false,
        description: "JKH dividend",
      });
    }
    if (m % 6 === 5) {
      await post({
        type: "investment_income",
        date: day(28),
        amountMinor: 6_200_00,
        taxMinor: 310_00,
        toAccountId: bank.id,
        holdingId: moneyMarket.id,
        incomeKind: "interest",
        reinvest: true,
        description: "Money market interest",
      });
    }
    if (day(28) <= todayKey) {
      await addMarketLevel(ctx, { date: day(28), level: Math.round(aspi(m)) });
    }
    if (m === 10 && day(29) <= todayKey) {
      await recordDeployment(ctx, {
        date: day(29),
        sourceAccountId: opp.id,
        lines: [{ assetClassId: equity, holdingId: fund.id, amountMinor: 120_000_00, feeMinor: 0 }],
        notes: "ASPI down 13% from the high",
      });
      txns += 1;
    }

    // Month-end values (market holdings); big changes are confirmed (demo data)
    const monthEnd = key(endOfMonth(monthStart));
    if (monthEnd <= todayKey) {
      const value = async (id: string, factor: number) => {
        const h = (await HoldingModel.findOne({
          userId,
          _id: toObjectId(id, "Holding"),
        }).lean<HoldingDoc>())!;
        await recordValuation(ctx, id, {
          date: monthEnd,
          valueMinor: Math.max(1, Math.round(h.investedMinor * factor)),
          confirmBigChange: true,
        });
      };
      const drift = 1 + 0.006 * (m + 1);
      await value(fund.id, drift * (1 + (rand() - 0.4) * 0.05) * (m >= 9 && m <= 11 ? 0.92 : 1));
      await value(stock.id, (1 + (rand() - 0.45) * 0.14) * (m >= 9 && m <= 11 ? 0.88 : 1.02));
      await value(moneyMarket.id, 1 + 0.008 * (m + 1));
      await value(gold.id, 1.04 + 0.012 * (m + 1));
      await value(etf.id, 1.04 + 0.014 * (m + 1));
    }
    cardSpendLastMonth = cardSpend;
  }
  // A small USD purchase
  await post({
    type: "expense",
    date: key(addDays(today, -9)),
    amountMinor: 45_00,
    fromAccountId: usd.id,
    categoryId: cat("Education", "expense"),
    description: "Online course",
    counterparty: "Udemy",
  });

  // ---- Planning: recurring rules (from next occurrences on), budgets, goals, insurance, rules
  const nextMonth = addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1);
  const nm = (d: number) => key(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), d));
  await createRule(ctx, {
    name: "Salary",
    kind: "income",
    amountMinor: 450_000_00,
    toAccountId: bank.id,
    categoryId: cat("Salary", "income"),
    frequency: "monthly",
    dayOfMonth: 25,
    startDate:
      key(new Date(today.getFullYear(), today.getMonth(), 25)) > todayKey
        ? key(new Date(today.getFullYear(), today.getMonth(), 25))
        : nm(25),
  });
  await createRule(ctx, {
    name: "House rent",
    kind: "expense",
    amountMinor: 85_000_00,
    fromAccountId: bank.id,
    categoryId: cat("Rent", "expense"),
    frequency: "monthly",
    dayOfMonth: 3,
    startDate: nm(3),
    reminderDaysBefore: 3,
  });
  await createRule(ctx, {
    name: "Netflix",
    kind: "expense",
    amountMinor: 2_990_00,
    fromAccountId: card.id,
    categoryId: cat("Entertainment", "expense"),
    frequency: "monthly",
    dayOfMonth: 7,
    startDate: nm(7),
  });
  await createRule(ctx, {
    name: "Lease instalment",
    kind: "debt_payment",
    amountMinor: debt.emiMinor,
    fromAccountId: bank.id,
    debtId,
    frequency: "monthly",
    dayOfMonth: 15,
    startDate:
      key(new Date(today.getFullYear(), today.getMonth(), 15)) > todayKey
        ? key(new Date(today.getFullYear(), today.getMonth(), 15))
        : nm(15),
  });
  for (let back = 0; back <= 2; back++) {
    const month = format(addMonths(today, -back), "yyyy-MM");
    await setBudget(ctx, {
      month,
      categoryId: cat("Groceries", "expense"),
      amountMinor: 55_000_00,
    });
    await setBudget(ctx, {
      month,
      categoryId: cat("Restaurants", "expense"),
      amountMinor: 18_000_00,
    });
    await setBudget(ctx, {
      month,
      categoryId: cat("Utilities", "expense"),
      amountMinor: 20_000_00,
    });
  }
  await createGoal(ctx, {
    name: "House down payment",
    targetMinor: 5_000_000_00,
    targetDate: key(addYears(today, 3)),
    priority: 1,
    expectedReturnBp: 800,
    links: [
      { kind: "account", refId: bank.id, shareBp: 3_000 },
      { kind: "holding", refId: fund.id, shareBp: 5_000 },
    ],
  });
  await createGoal(ctx, {
    name: "Japan trip",
    targetMinor: 900_000_00,
    targetDate: key(addMonths(today, 10)),
    priority: 3,
    links: [{ kind: "holding", refId: moneyMarket.id, shareBp: 10_000 }],
  });
  await createPolicy(ctx, {
    type: "life",
    provider: "AIA",
    policyNumberLast4: "4821",
    coverMinor: 15_000_000_00,
    premiumMinor: 12_500_00,
    premiumFrequency: "monthly",
    startDate: startKey,
    renewalDate: key(addDays(today, 21)),
    nominee: "Spouse",
  });
  await createPolicy(ctx, {
    type: "health",
    provider: "Ceylinco",
    coverMinor: 1_500_000_00,
    premiumMinor: 48_000_00,
    premiumFrequency: "yearly",
    startDate: startKey,
    renewalDate: key(addMonths(today, 5)),
  });
  for (const [pattern, name] of [
    ["keells", "Groceries"],
    ["pickme", "Taxi & ride"],
    ["ceb", "Utilities"],
  ] as const) {
    await createCategoryRule(ctx, {
      matchField: "description",
      operator: "contains",
      pattern,
      categoryId: cat(name, "expense"),
    });
  }

  // ---- Earmarks last (the dip guard would otherwise ask about the spending above)
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "emergency",
    mode: "fixed",
    amountMinor: 150_000_00,
  });
  await setEarmark(ctx, {
    accountId: bank.id,
    bucket: "opportunity",
    mode: "percent",
    percentBp: 1_000,
  });

  // Part of the money market fund is emergency money that keeps earning (holding earmark).
  await setHoldingEarmark(ctx, {
    holdingId: moneyMarket.id,
    bucket: "emergency",
    mode: "percent",
    percentBp: 4_000,
  });

  const { months } = await rebuildHistory(ctx);
  await ensureMonthlyReview(ctx, todayKey);
  const notifications = await runNotifications(ctx, todayKey);
  return {
    accounts: await accountCount(ctx),
    transactions: txns,
    holdings: 6,
    months,
    sipExecutions: sipDone,
    notifications,
  };
}
