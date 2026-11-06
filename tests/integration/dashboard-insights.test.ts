import { describe, expect, it } from "vitest";
import { parseRangeView } from "@/domain/date-range";
import { utcToBusinessDate } from "@/domain/dates";
import {
  getCostsThisYear,
  getInvestmentsSummary,
  getNetWorthBridges,
  getSpendingPace,
} from "@/modules/dashboard/queries";
import { recordValuation } from "@/modules/holdings/service";
import { categoryId, makeAccount, makeHolding, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

// docs/04 §25 — the four dashboard insight cards, from the ledger.
async function setup() {
  const ctx = await makeUser();
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000_000 });
  const wallet = await makeAccount(ctx, { name: "Wallet", type: "cash", openingBalanceMinor: 0 });
  const fund = await makeHolding(ctx, { name: "Equity fund" });
  // 1 January of this year: a buy (in this month too when run in January).
  const buyDate = `${today.slice(0, 4)}-01-01`;
  await post(ctx, {
    type: "invest",
    date: buyDate,
    amountMinor: 10_000_000,
    feeMinor: 2_500,
    fromAccountId: bank.id,
    holdingId: fund.id,
  });
  // This month: salary, groceries, a bank fee, a transfer with a fee, and a market move.
  await post(ctx, {
    type: "income",
    date: monthStart,
    amountMinor: 5_000_000,
    toAccountId: bank.id,
    categoryId: await categoryId(ctx, "Salary"),
  });
  await post(ctx, {
    type: "expense",
    date: today,
    amountMinor: 1_200_000,
    fromAccountId: bank.id,
    categoryId: await categoryId(ctx, "Groceries"),
  });
  await post(ctx, {
    type: "expense",
    date: today,
    amountMinor: 33_579,
    fromAccountId: bank.id,
    categoryId: await categoryId(ctx, "Bank fees", "expense"),
  });
  await post(ctx, {
    type: "transfer",
    date: today,
    amountMinor: 500_000,
    feeMinor: 5_000,
    fromAccountId: bank.id,
    toAccountId: wallet.id,
  });
  await recordValuation(ctx, fund.id, {
    date: today,
    valueMinor: 11_000_000,
    confirmBigChange: true,
  });
  // This month's market gain counts the buy's 25 fee as a cost only when the buy is in it.
  const monthMarketGain = buyDate >= monthStart ? 997_500 : 1_000_000;
  return { ctx, today, monthMarketGain };
}

describe("dashboard insight cards (docs/04 §25)", () => {
  it("net worth change = saved + market gain + other; this month and the range", async () => {
    const { ctx, today, monthMarketGain } = await setup();
    const view = parseRangeView({ r: "ytd" }, today);
    const b = await getNetWorthBridges(ctx, view);
    // Saved: 50,000 income − (12,000 + 335.79 + 50 transfer fee).
    expect(b.month.savedMinor).toBe(5_000_000 - 1_200_000 - 33_579 - 5_000);
    // Market gain this month: the fund went 100,000 → 110,000 (no money added this month).
    expect(b.month.marketGainMinor).toBe(monthMarketGain);
    expect(b.month.otherMinor).toBe(0);
    expect(b.month.changeMinor).toBe(
      b.month.savedMinor + b.month.marketGainMinor + b.month.otherMinor,
    );
    // The year includes the 1 January buy and its fee.
    expect(b.range.savedMinor + b.range.marketGainMinor + b.range.otherMinor).toBe(
      b.range.changeMinor,
    );
  });

  it("investments: value, invested, gain and market gain this month", async () => {
    const { ctx, monthMarketGain } = await setup();
    const s = await getInvestmentsSummary(ctx);
    expect(s).toMatchObject({
      valueMinor: 11_000_000,
      investedMinor: 10_002_500,
      gainMinor: 997_500,
      marketGainMonthMinor: monthMarketGain,
    });
    expect(s.points.length).toBeGreaterThanOrEqual(2);
  });

  it("spending pace: no complete months of history → no comparison", async () => {
    const { ctx } = await setup();
    const p = await getSpendingPace(ctx);
    expect(p.spentMinor).toBe(1_200_000 + 33_579 + 5_000);
    expect(p.status).toBe("no_history");
  });

  it("fees & interest this year: bank fees, transfer and investment fees", async () => {
    const { ctx } = await setup();
    const c = await getCostsThisYear(ctx);
    expect(c.items).toEqual([
      { kind: "bank_fees", amountMinor: 33_579 },
      { kind: "transfer_fees", amountMinor: 5_000 },
      { kind: "investment_fees", amountMinor: 2_500 },
    ]);
    expect(c.totalMinor).toBe(33_579 + 5_000 + 2_500);
  });
});
