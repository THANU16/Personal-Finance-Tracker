import { describe, expect, it } from "vitest";
import type { HoldingEvent } from "@/domain/holdings";
import {
  computeInvestmentSeries,
  firstEventDate,
  holdingInvestedValues,
  type InvestmentSeriesInput,
} from "@/domain/investment-series";

let seq = 0;
const txn = (
  type: "opening_balance" | "invest" | "redeem" | "investment_income",
  date: string,
  amountMinor: number,
  extra: Partial<Extract<HoldingEvent, { kind: "txn" }>> = {},
): HoldingEvent => ({ kind: "txn", id: `t${++seq}`, type, date, seq, amountMinor, ...extra });
const val = (date: string, valueMinor: number): HoldingEvent => ({
  kind: "valuation",
  id: `v${++seq}`,
  date,
  seq,
  valueMinor,
});

const at = (events: HoldingEvent[], dates: string[], valueAt?: (d: string) => number) =>
  holdingInvestedValues(events, { trackUnits: false, valueAt }, dates);

describe("holdingInvestedValues (docs/04 §24.2)", () => {
  it("spreads a valuation's move back to the first buy and holds it after", () => {
    const events = [txn("invest", "2026-01-01", 100_000), val("2026-01-11", 110_000)];
    expect(
      at(events, ["2025-12-31", "2026-01-01", "2026-01-06", "2026-01-11", "2026-01-20"]),
    ).toEqual([
      { investedMinor: 0, valueMinor: 0 },
      { investedMinor: 100_000, valueMinor: 100_000 },
      { investedMinor: 100_000, valueMinor: 105_000 },
      { investedMinor: 100_000, valueMinor: 110_000 },
      { investedMinor: 100_000, valueMinor: 110_000 },
    ]);
  });

  it("keeps a buy's full effect on its day and spreads only the market move", () => {
    // Before the valuation the §3 value is 150,000; the valuation adds a 10,000 move.
    const events = [
      txn("invest", "2026-01-01", 100_000),
      txn("invest", "2026-01-06", 50_000),
      val("2026-01-11", 160_000),
    ];
    expect(at(events, ["2026-01-05", "2026-01-06", "2026-01-11"])).toEqual([
      { investedMinor: 100_000, valueMinor: 104_000 },
      { investedMinor: 150_000, valueMinor: 155_000 },
      { investedMinor: 150_000, valueMinor: 160_000 },
    ]);
  });

  it("does not spread a value entered on the first day (opening balance)", () => {
    const events = [txn("opening_balance", "2026-01-01", 100_000), val("2026-01-01", 120_000)];
    expect(at(events, ["2026-01-01", "2026-01-15"])).toEqual([
      { investedMinor: 100_000, valueMinor: 120_000 },
      { investedMinor: 100_000, valueMinor: 120_000 },
    ]);
  });

  it("restarts after a full redemption, so a closed position stays at 0", () => {
    const events = [
      txn("invest", "2026-01-01", 100_000),
      val("2026-01-11", 110_000),
      txn("redeem", "2026-01-21", 110_000),
      txn("invest", "2026-02-01", 50_000),
      val("2026-02-11", 55_000),
    ];
    expect(at(events, ["2026-01-25", "2026-02-01", "2026-02-06", "2026-02-11"])).toEqual([
      { investedMinor: 0, valueMinor: 0 },
      { investedMinor: 50_000, valueMinor: 50_000 },
      { investedMinor: 50_000, valueMinor: 52_500 },
      { investedMinor: 50_000, valueMinor: 55_000 },
    ]);
  });

  it("adds several valuations on one day as one move", () => {
    const events = [
      txn("invest", "2026-01-01", 100_000),
      val("2026-01-11", 104_000),
      val("2026-01-11", 110_000),
    ];
    expect(at(events, ["2026-01-06"])[0]!.valueMinor).toBe(105_000);
  });

  it("uses the deposit terms for FDs every day (no spreading)", () => {
    const fd = (d: string) => 100_000 + Number(d.slice(8)) * 10;
    const events = [txn("invest", "2026-01-01", 100_000), val("2026-01-20", 999_999)];
    expect(at(events, ["2026-01-05", "2026-01-25"], fd).map((v) => v.valueMinor)).toEqual([
      100_050, 100_250,
    ]);
  });
});

describe("computeInvestmentSeries (docs/04 §24)", () => {
  const A = [
    txn("invest", "2026-01-10", 100_000),
    val("2026-01-20", 110_000),
    txn("invest", "2026-02-10", 50_000),
    val("2026-02-20", 170_000),
    txn("redeem", "2026-03-05", 30_000),
    txn("investment_income", "2026-03-15", 2_000),
  ];
  const input = (extra: Partial<InvestmentSeriesInput> = {}): InvestmentSeriesInput => ({
    holdings: [{ id: "a", currency: "LKR", trackUnits: false }],
    holdingEvents: new Map([["a", A]]),
    toBase: (m) => m,
    ...extra,
  });
  const range = { from: "2026-01-01", to: "2026-03-31" };

  it("points are bucket ends, valuation days and flow days, with dots and the day before", () => {
    const s = computeInvestmentSeries(input(), range, "month");
    expect(s.points.map((p) => p.date)).toEqual([
      "2026-01-10",
      "2026-01-20",
      "2026-01-31",
      "2026-02-10",
      "2026-02-20",
      "2026-02-28",
      "2026-03-05",
      "2026-03-15",
      "2026-03-31",
    ]);
    expect(s.points.filter((p) => p.entered).map((p) => p.date)).toEqual([
      "2026-01-20",
      "2026-02-20",
    ]);
    // 10,000 move from 20 Jan to 20 Feb (31 days) spread daily.
    const feb10 = s.points.find((p) => p.date === "2026-02-10")!;
    expect(feb10).toMatchObject({
      investedMinor: 150_000,
      valueMinor: 166_774, // 160,000 + 10,000 × 21/31
      before: { investedMinor: 100_000, valueMinor: 116_452 }, // 9 Feb: 110,000 + 10,000 × 20/31
    });
    expect(s.points.find((p) => p.date === "2026-01-31")!.before).toBeNull();
  });

  it("summary: gain at the end, market gain without money in/out, income in the range", () => {
    const s = computeInvestmentSeries(input(), range, "month");
    expect(s.baseline).toEqual({ investedMinor: 0, valueMinor: 0 });
    // Redeem 30,000: cost recovery removes 30,000 of invested (§3).
    expect(s.end).toEqual({
      investedMinor: 120_000,
      valueMinor: 140_000,
      gainMinor: 20_000,
      gainBp: 1667,
    });
    // (140,000 − 0) − (100,000 + 50,000 − 30,000)
    expect(s.marketGainMinor).toBe(20_000);
    expect(s.incomeMinor).toBe(2_000);
    expect(s.fxMissing).toBe(0);
  });

  it("market gain inside a later range starts from the baseline day", () => {
    const s = computeInvestmentSeries(input(), { from: "2026-02-01", to: "2026-02-28" }, "week");
    // Baseline 31 Jan 113,548; end 170,000; money in 50,000.
    expect(s.baseline.valueMinor).toBe(113_548);
    expect(s.marketGainMinor).toBe(170_000 - 113_548 - 50_000);
    expect(s.incomeMinor).toBe(0);
  });

  it("an opening balance counts its whole first-day value as money in", () => {
    const s = computeInvestmentSeries(
      input({
        holdingEvents: new Map([
          ["a", [txn("opening_balance", "2026-01-05", 100_000), val("2026-01-05", 130_000)]],
        ]),
      }),
      { from: "2026-01-01", to: "2026-01-31" },
      "week",
    );
    expect(s.end).toMatchObject({ investedMinor: 100_000, valueMinor: 130_000, gainMinor: 30_000 });
    expect(s.marketGainMinor).toBe(0);
  });

  it("converts each holding on each date and counts a missing rate", () => {
    const usd = [txn("invest", "2026-01-10", 1_000), val("2026-01-20", 1_100)];
    const toBase = (m: number, ccy: string, d: string) =>
      ccy === "LKR" ? m : d >= "2026-01-15" ? m * 300 : null;
    const s = computeInvestmentSeries(
      {
        holdings: [
          { id: "a", currency: "LKR", trackUnits: false },
          { id: "u", currency: "USD", trackUnits: false },
        ],
        holdingEvents: new Map([
          ["a", A],
          ["u", usd],
        ]),
        toBase,
      },
      { from: "2026-01-01", to: "2026-01-31" },
      "week",
    );
    const jan10 = s.points.find((p) => p.date === "2026-01-10")!;
    expect(jan10.valueMinor).toBe(100_000); // USD left out: no rate yet
    expect(s.end.valueMinor).toBe(113_548 + 1_100 * 300);
    expect(s.fxMissing).toBe(0);
  });

  it("an empty scope is all zeros", () => {
    const s = computeInvestmentSeries(input({ holdings: [] }), range, "month");
    expect(s.end).toEqual({ investedMinor: 0, valueMinor: 0, gainMinor: 0, gainBp: null });
    expect(s.points.every((p) => p.valueMinor === 0)).toBe(true);
  });
});

describe("firstEventDate", () => {
  it("is the earliest event of the chosen holdings", () => {
    const events = new Map([
      ["a", [val("2026-02-01", 1), txn("invest", "2026-01-15", 1)]],
      ["b", [txn("invest", "2025-12-01", 1)]],
    ]);
    expect(firstEventDate(events, ["a"])).toBe("2026-01-15");
    expect(firstEventDate(events, ["a", "b"])).toBe("2025-12-01");
    expect(firstEventDate(events, [])).toBeNull();
  });

  it("ignores a 0 value recorded on an empty holding (no dot, not the start)", () => {
    const events = [val("2026-01-01", 0), txn("invest", "2026-01-10", 100), val("2026-01-20", 110)];
    expect(firstEventDate(new Map([["a", events]]), ["a"])).toBe("2026-01-10");
    const s = computeInvestmentSeries(
      {
        holdings: [{ id: "a", currency: "LKR", trackUnits: false }],
        holdingEvents: new Map([["a", events]]),
        toBase: (m) => m,
      },
      { from: "2026-01-01", to: "2026-01-31" },
      "month",
    );
    expect(s.points.map((p) => [p.date, p.entered])).toEqual([
      ["2026-01-10", false],
      ["2026-01-20", true],
      ["2026-01-31", false],
    ]);
  });
});
