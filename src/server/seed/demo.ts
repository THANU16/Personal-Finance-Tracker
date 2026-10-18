import "server-only";
import type { mongo } from "mongoose";
import { addDays, addMonths, endOfMonth, format, parse } from "date-fns";
import { createAccount } from "@/modules/accounts/service";
import { AccountModel } from "@/modules/accounts/model";
import { AssetClassModel } from "@/modules/asset-classes/model";
import { CategoryModel, type CategoryDoc, type CategoryKind } from "@/modules/categories/model";
import { setEarmark } from "@/modules/earmarks/service";
import { saveFxRate } from "@/modules/fx/service";
import { createHolding, recordValuation } from "@/modules/holdings/service";
import { rebuildHistory } from "@/modules/snapshots/service";
import { createTransaction } from "@/modules/transactions/service";
import type { TransactionInput } from "@/modules/transactions/schemas";
import type { Ctx } from "@/server/ctx";
import { toObjectId } from "@/server/db/ids";

// Realistic demo data for ONE existing user (owner request: see the UI with data before Phase 12).
// Everything goes through the services, so balances, holdings, earmarks and snapshots stay consistent.

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
}

/** Seeds ~6 months of history ending today (business dates in the user's timezone). */
export async function seedDemoData(ctx: Ctx, todayKey: string): Promise<SeedSummary> {
  const userId = toObjectId(ctx.userId, "User");
  const today = toDate(todayKey);
  const start = addMonths(new Date(today.getFullYear(), today.getMonth(), 1), -6);
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

  // ---- FX: monthly USD → LKR rates from the start
  for (let m = 0; m <= 6; m++) {
    const d = key(addMonths(start, m));
    if (d > todayKey) break;
    await saveFxRate(ctx, { date: d, base: "USD", quote: ctx.baseCurrency, rate: 298 + m * 0.85 });
  }

  // ---- Accounts
  const acct = (input: Parameters<typeof createAccount>[1]) =>
    createAccount(ctx, { openingDate: startKey, ...(input as object) });
  const bank = await acct({
    name: "Commercial Bank Savings",
    type: "bank",
    currency: ctx.baseCurrency,
    institution: "Commercial Bank",
    openingBalanceMinor: 450_000_00,
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
  await acct({
    name: "Opportunity fund",
    type: "opportunity_fund",
    currency: ctx.baseCurrency,
    openingBalanceMinor: 300_000_00,
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

  const post = async (input: TransactionInput) => {
    if (input.date > todayKey) return;
    await createTransaction(ctx, input);
    txns += 1;
  };

  // ---- Holdings (opening values on the start date)
  const fund = await createHolding(ctx, {
    name: "CAL Balanced Fund",
    assetClassId: await classId("Equity"),
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
    assetClassId: await classId("Equity"),
    instrumentType: "stock",
    currency: ctx.baseCurrency,
    platform: "CAL",
    openingDate: startKey,
    investedMinor: 180_000_00,
    currentValueMinor: 171_500_00,
  });
  const gold = await createHolding(ctx, {
    name: "Gold sovereigns",
    assetClassId: await classId("Gold"),
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
    assetClassId: await classId("Equity"),
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
    assetClassId: await classId("Fixed Income"),
    instrumentType: "fd",
    currency: ctx.baseCurrency,
    platform: "NSB",
    fd: {
      principalMinor: 1_000_000_00,
      rateBp: 1_100,
      startDate: key(addDays(start, 14)),
      maturityDate: key(addMonths(addDays(start, 14), 12)),
      compounding: "monthly",
      payout: "at_maturity",
    },
  });

  // ---- Six months of everyday money
  let cardSpendLastMonth = 0;
  for (let m = 0; m <= 6; m++) {
    const monthStart = addMonths(start, m);
    const day = (d: number) => key(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
    let cardSpend = 0;

    await post({
      type: "income",
      date: day(25),
      amountMinor: 350_000_00,
      toAccountId: bank.id,
      categoryId: cat("Salary", "income"),
      description: "Salary",
      counterparty: "Employer",
    });
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
      const onCard = d % 2 === 0;
      await post({
        type: "expense",
        date: day(d),
        amountMinor: amount,
        fromAccountId: onCard ? card.id : current.id,
        categoryId: cat("Groceries", "expense"),
        description: "Weekly groceries",
        counterparty: "Keells",
      });
      if (onCard && day(d) <= todayKey) cardSpend += amount;
    }
    for (const d of [6, 20]) {
      const amount = between(3_000_00, 9_000_00);
      await post({
        type: "expense",
        date: day(d),
        amountMinor: amount,
        fromAccountId: card.id,
        categoryId: cat("Restaurants", "expense"),
        description: "Dinner out",
      });
      if (day(d) <= todayKey) cardSpend += amount;
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

    // Pay last month's card bill and top up the current account (a transfer fee once)
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
      feeMinor: m === 2 ? 50_00 : 0,
      description: "Monthly spending money",
    });
    await post({
      type: "transfer",
      date: day(26),
      amountMinor: 20_000_00,
      fromAccountId: bank.id,
      toAccountId: cash.id,
      description: "ATM withdrawal",
    });

    // Investing: a monthly unit trust buy, quarterly dividends, month-end valuations
    await post({
      type: "invest",
      date: day(10),
      amountMinor: 25_000_00,
      feeMinor: 0,
      fromAccountId: bank.id,
      holdingId: fund.id,
      description: "Monthly unit trust",
    });
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
    const monthEnd = key(endOfMonth(monthStart));
    if (monthEnd <= todayKey) {
      const growth = 1 + (rand() - 0.35) * 0.04;
      await recordValuation(ctx, fund.id, {
        date: monthEnd,
        valueMinor: Math.round((412_000_00 + 25_000_00 * (m + 1)) * growth ** (m + 1)),
      });
      await recordValuation(ctx, stock.id, {
        date: monthEnd,
        valueMinor: Math.round(171_500_00 * (1 + (rand() - 0.4) * 0.12)),
      });
      await recordValuation(ctx, gold.id, {
        date: monthEnd,
        valueMinor: Math.round(262_000_00 * (1 + 0.012 * (m + 1))),
      });
      await recordValuation(ctx, etf.id, {
        date: monthEnd,
        valueMinor: Math.round(2_080_00 * (1 + 0.015 * (m + 1))),
      });
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
    percentBp: 2_000,
  });

  const { months } = await rebuildHistory(ctx);
  return {
    accounts: await accountCount(ctx),
    transactions: txns,
    holdings: 5,
    months,
  };
}
