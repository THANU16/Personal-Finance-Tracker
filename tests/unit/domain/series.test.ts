import { describe, expect, it } from "vitest";
import { buildBuckets } from "@/domain/date-range";
import { fdValue, type FdTerms } from "@/domain/fd";
import { buildFxTable, makeConverter } from "@/domain/fx";
import type { HoldingEvent } from "@/domain/holdings";
import {
  computeNetWorthAsOf,
  computeNetWorthSeries,
  type SeriesInput,
  type SeriesTxn,
} from "@/domain/series";

const toBase = makeConverter(
  buildFxTable([
    { date: "2026-01-01", base: "USD", quote: "LKR", rate: 300 },
    { date: "2026-03-01", base: "USD", quote: "LKR", rate: 320 },
  ]),
  "LKR",
);

const fd: FdTerms = {
  principalMinor: 1_000_000,
  rateBp: 1_200,
  startDate: "2026-01-01",
  maturityDate: "2026-12-31",
  compounding: "monthly",
  payout: "at_maturity",
};

let seq = 0;
const txn = (
  t: Partial<SeriesTxn> & Pick<SeriesTxn, "type" | "date" | "amountMinor">,
): SeriesTxn => ({
  status: "posted",
  seq: ++seq,
  ...t,
});

function scenario(): SeriesInput {
  const holdingEvents = new Map<string, HoldingEvent[]>([
    [
      "ut",
      [
        {
          kind: "txn",
          id: "ut-open",
          type: "opening_balance",
          date: "2026-01-01",
          seq: 1,
          amountMinor: 50_000,
        },
        { kind: "valuation", id: "ut-v1", date: "2026-01-01", seq: 2, valueMinor: 50_000 },
        {
          kind: "txn",
          id: "ut-buy",
          type: "invest",
          date: "2026-02-10",
          seq: 3,
          amountMinor: 20_000,
          feeMinor: 100,
        },
        { kind: "valuation", id: "ut-v2", date: "2026-03-15", seq: 4, valueMinor: 80_000 },
      ],
    ],
    [
      "fd",
      [
        {
          kind: "txn",
          id: "fd-open",
          type: "opening_balance",
          date: "2026-01-01",
          seq: 5,
          amountMinor: 1_000_000,
        },
      ],
    ],
  ]);
  return {
    accounts: [
      {
        id: "bank",
        type: "bank",
        currency: "LKR",
        includeInNetWorth: true,
        openingBalanceMinor: 300_000,
        openingDate: "2026-01-01",
      },
      {
        id: "card",
        type: "credit_card",
        currency: "LKR",
        includeInNetWorth: true,
        openingBalanceMinor: 0,
        openingDate: "2026-01-01",
      },
      {
        id: "usd",
        type: "bank",
        currency: "USD",
        includeInNetWorth: true,
        openingBalanceMinor: 1_000,
        openingDate: "2026-02-01",
      },
      {
        id: "eur",
        type: "cash",
        currency: "EUR",
        includeInNetWorth: true,
        openingBalanceMinor: 500,
        openingDate: "2026-01-01",
      },
      {
        id: "hidden",
        type: "bank",
        currency: "LKR",
        includeInNetWorth: false,
        openingBalanceMinor: 9_999,
        openingDate: "2026-01-01",
      },
    ],
    holdings: [
      { id: "ut", currency: "LKR", assetClassId: "equity", trackUnits: false },
      {
        id: "fd",
        currency: "LKR",
        assetClassId: "fixed",
        trackUnits: false,
        valueAt: (d) => fdValue(fd, d),
      },
    ],
    txns: [
      txn({ type: "expense", date: "2026-01-05", amountMinor: 10_000, fromAccountId: "bank" }),
      txn({ type: "expense", date: "2026-01-20", amountMinor: 25_000, fromAccountId: "card" }),
      txn({
        type: "invest",
        date: "2026-02-10",
        amountMinor: 20_000,
        feeMinor: 100,
        fromAccountId: "bank",
      }),
      txn({
        type: "transfer",
        date: "2026-02-25",
        amountMinor: 25_000,
        fromAccountId: "bank",
        toAccountId: "card",
      }),
      txn({
        type: "income",
        date: "2026-03-01",
        amountMinor: 100_000,
        toAccountId: "bank",
        status: "void",
      }),
    ],
    holdingEvents,
    toBase,
  };
}

describe("computeNetWorthSeries", () => {
  const input = scenario();
  const ends = buildBuckets({ from: "2026-01-01", to: "2026-04-30" }, "month").map((b) => b.end);
  const series = computeNetWorthSeries(input, ends);

  it("every point equals computeNetWorthAsOf for the same date", () => {
    for (const p of series) expect(computeNetWorthAsOf(input, p.date)).toEqual(p);
    for (const day of ["2026-01-04", "2026-01-05", "2026-02-10", "2026-02-24", "2026-03-15"]) {
      const daily = computeNetWorthSeries(
        input,
        buildBuckets({ from: "2026-01-01", to: "2026-03-31" }, "day").map((b) => b.end),
      );
      expect(daily.find((p) => p.date === day)).toEqual(computeNetWorthAsOf(input, day));
    }
  });

  it("January: liabilities are negative balances; assets include holdings; FD accrues", () => {
    const jan = series[0]!;
    const fdJan = fdValue(fd, "2026-01-31");
    expect(fdJan).toBeGreaterThan(1_000_000);
    expect(jan.liabilitiesMinor).toBe(25_000); // card spend
    expect(jan.cashMinor).toBe(290_000);
    expect(jan.holdingsValueMinor).toBe(50_000 + fdJan);
    expect(jan.assetsMinor).toBe(290_000 + 50_000 + fdJan);
    expect(jan.netWorthMinor).toBe(jan.assetsMinor - 25_000);
    expect(jan.byClass).toEqual({ equity: 50_000, fixed: fdJan });
    expect(jan.byAccountType).toEqual({ bank: 290_000, credit_card: -25_000 });
  });

  it("FD value grows month by month in the series (never the cached value)", () => {
    const fdValues = series.map((p) => p.byHolding.fd!);
    expect(fdValues).toEqual(ends.map((d) => fdValue(fd, d)));
    for (let k = 1; k < fdValues.length; k++)
      expect(fdValues[k]!).toBeGreaterThan(fdValues[k - 1]!);
  });

  it("flows move value and invested; a valuation resets value", () => {
    const [jan, feb, mar] = series;
    expect(feb!.byHolding.ut).toBe(70_000);
    expect(feb!.investedMinor - jan!.investedMinor).toBe(20_100);
    expect(mar!.byHolding.ut).toBe(80_000);
  });

  it("accounts count from their opening date and convert at that date's rate; void is ignored", () => {
    const [jan, feb, mar] = series;
    expect(jan!.byAccountType.bank).toBe(290_000); // USD account not open yet
    // Feb: bank 290,000 − 20,100 − 25,000 = 244,900; USD $10 × 300
    expect(feb!.byAccountType.bank).toBe(244_900 + 300_000);
    expect(mar!.byAccountType.bank).toBe(244_900 + 320_000); // new rate, void income ignored
  });

  it("missing FX: excluded and counted, never 1:1", () => {
    for (const p of series) expect(p.fxMissing).toBe(1); // the EUR cash account
    expect(series[0]!.cashMinor).toBe(290_000);
  });

  it("accounts with includeInNetWorth=false are left out", () => {
    expect(JSON.stringify(series)).not.toContain("9999");
  });

  it("an empty bucket carries the closing value forward", () => {
    const daily = computeNetWorthSeries(input, ["2026-01-06", "2026-01-07", "2026-01-08"]);
    const fdOnly = (p: (typeof daily)[number]) => p.netWorthMinor - (p.byHolding.fd ?? 0);
    expect(new Set(daily.map(fdOnly)).size).toBe(1);
  });

  it("before any data there is nothing", () => {
    expect(computeNetWorthAsOf(input, "2025-12-31")).toMatchObject({
      netWorthMinor: 0,
      assetsMinor: 0,
      fxMissing: 0,
    });
  });
});
