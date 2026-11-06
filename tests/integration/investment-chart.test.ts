import { describe, expect, it } from "vitest";
import { recordValuation } from "@/modules/holdings/service";
import { getInvestmentChart, parseInvestmentScope } from "@/modules/holdings/queries";
import { voidTransaction } from "@/modules/transactions/service";
import { assetClassId, makeAccount, makeHolding, makeUser, post } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

// docs/04 §24 — the same figures as the domain worked example, ×100 (minor units), from the ledger.
async function setup() {
  const ctx = await makeUser();
  const bank = await makeAccount(ctx, { openingBalanceMinor: 100_000_000 });
  const fund = await makeHolding(ctx, { name: "Ceylon Equity Fund" });
  const gold = await makeHolding(ctx, {
    name: "Gold",
    assetClassId: await assetClassId(ctx, "Gold"),
    countsTowardEmergencyFund: true,
  });
  const buy = (holdingId: string, date: string, amountMinor: number) =>
    post(ctx, { type: "invest", date, amountMinor, fromAccountId: bank.id, holdingId });
  await buy(fund.id, "2026-01-10", 10_000_000);
  await recordValuation(ctx, fund.id, {
    date: "2026-01-20",
    valueMinor: 11_000_000,
    confirmBigChange: true,
  });
  await buy(fund.id, "2026-02-10", 5_000_000);
  await recordValuation(ctx, fund.id, {
    date: "2026-02-20",
    valueMinor: 17_000_000,
    confirmBigChange: true,
  });
  const redeem = await post(ctx, {
    type: "redeem",
    date: "2026-03-05",
    amountMinor: 3_000_000,
    toAccountId: bank.id,
    holdingId: fund.id,
  });
  await buy(gold.id, "2026-03-01", 2_000_000);
  return { ctx, fund, gold, redeem };
}

const Q1 = { r: "custom", from: "2026-01-01", to: "2026-03-31", g: "month" };

describe("getInvestmentChart (docs/04 §24)", () => {
  it("one holding: real values only, dots, summary; void moves the chart with the ledger", async () => {
    const { ctx, fund, redeem } = await setup();
    const chart = () =>
      getInvestmentChart(ctx, {
        searchParams: Q1,
        scope: { kind: "holding", id: fund.id },
        defaultPreset: "all",
      });
    let c = await chart();
    expect(c.currency).toBe("LKR");
    expect(c.view.range).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(c.points.filter((p) => p.entered).map((p) => p.date)).toEqual([
      "2026-01-20",
      "2026-02-20",
    ]);
    expect(c.points.find((p) => p.date === "2026-02-10")).toMatchObject({
      investedMinor: 15_000_000,
      valueMinor: 16_000_000, // 110,000 held + the 50,000 buy: nothing estimated
      before: { investedMinor: 10_000_000, valueMinor: 11_000_000 },
    });
    expect(c.end).toEqual({
      investedMinor: 12_000_000,
      valueMinor: 14_000_000,
      gainMinor: 2_000_000,
      gainBp: 1667,
    });
    expect(c.marketGainMinor).toBe(2_000_000);

    await voidTransaction(ctx, redeem, { reason: "test" });
    c = await chart();
    expect(c.end).toMatchObject({ investedMinor: 15_000_000, valueMinor: 17_000_000 });
  });

  it("scopes: all, one class, emergency hidden; filter options list both", async () => {
    const { ctx, fund, gold } = await setup();
    const all = await getInvestmentChart(ctx, {
      searchParams: Q1,
      scope: { kind: "all" },
      defaultPreset: "1y",
    });
    expect(all.end.investedMinor).toBe(12_000_000 + 2_000_000);
    expect(all.options.holdings.map((h) => h.name)).toEqual(["Ceylon Equity Fund", "Gold"]);
    expect(all.options.classes.map((c) => c.name).sort()).toEqual(["Equity", "Gold"]);

    const goldClass = await getInvestmentChart(ctx, {
      searchParams: Q1,
      scope: { kind: "class", id: await assetClassId(ctx, "Gold") },
      defaultPreset: "1y",
    });
    expect(goldClass.end).toMatchObject({ investedMinor: 2_000_000, valueMinor: 2_000_000 });

    const noEmergency = await getInvestmentChart(ctx, {
      searchParams: Q1,
      scope: { kind: "all" },
      defaultPreset: "1y",
      excludeEmergency: true,
    });
    expect(noEmergency.end.investedMinor).toBe(12_000_000);

    // "All" starts at the first event of what is shown.
    const allTime = await getInvestmentChart(ctx, {
      searchParams: {},
      scope: { kind: "holding", id: gold.id },
      defaultPreset: "all",
    });
    expect(allTime.view.range.from).toBe("2026-03-01");
    expect(fund.id).not.toBe(gold.id);
  });

  it("only sees the user's own holdings", async () => {
    const { fund } = await setup();
    const other = await makeUser();
    await expect(
      getInvestmentChart(other, {
        searchParams: Q1,
        scope: { kind: "holding", id: fund.id },
        defaultPreset: "all",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("parseInvestmentScope", () => {
  it("accepts class/holding ids and falls back to all", () => {
    const id = "6ae429141ce4a3e31ac7e2e8";
    expect(parseInvestmentScope(`class:${id}`)).toEqual({ kind: "class", id });
    expect(parseInvestmentScope([`holding:${id}`])).toEqual({ kind: "holding", id });
    expect(parseInvestmentScope("holding:nope")).toEqual({ kind: "all" });
    expect(parseInvestmentScope(undefined)).toEqual({ kind: "all" });
  });
});
