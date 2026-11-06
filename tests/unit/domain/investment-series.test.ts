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

describe("holdingInvestedValues (docs/04 §24.2: no estimates)", () => {
  // Owner's example: d1 = 50,000, d2 = 80,000, d4 = 70,000; d3 (between d1 and d2) holds d1.
  const d1 = "2026-01-01";
  const d2 = "2026-01-03";
  const d4 = "2026-01-05";
  const example = [
    txn("opening_balance", d1, 50_000),
    val(d1, 50_000),
    val(d2, 80_000),
    val(d4, 70_000),
  ];

  it("a day between updates holds the previous value (never estimated)", () => {
    expect(
      at(example, ["2025-12-31", d1, "2026-01-02", d2, "2026-01-04", d4, "2026-01-20"]).map(
        (v) => v.valueMinor,
      ),
    ).toEqual([0, 50_000, 50_000, 80_000, 80_000, 70_000, 70_000]);
  });

  it("a buy adds its amount on its day; the next value replaces it", () => {
    const events = [
      txn("invest", "2026-01-01", 100_000),
      txn("invest", "2026-01-06", 50_000),
      val("2026-01-11", 160_000),
    ];
    expect(at(events, ["2026-01-05", "2026-01-06", "2026-01-11"])).toEqual([
      { investedMinor: 100_000, valueMinor: 100_000 },
      { investedMinor: 150_000, valueMinor: 150_000 },
      { investedMinor: 150_000, valueMinor: 160_000 },
    ]);
  });

  it("a full redemption leaves 0 until money goes in again", () => {
    const events = [
      txn("invest", "2026-01-01", 100_000),
      val("2026-01-11", 110_000),
      txn("redeem", "2026-01-21", 110_000),
      txn("invest", "2026-02-01", 50_000),
    ];
    expect(at(events, ["2026-01-25", "2026-02-01"])).toEqual([
      { investedMinor: 0, valueMinor: 0 },
      { investedMinor: 50_000, valueMinor: 50_000 },
    ]);
  });

  it("uses the deposit terms for FDs on each date", () => {
    const fd = (d: string) => 100_000 + Number(d.slice(8)) * 10;
    const events = [txn("invest", "2026-01-01", 100_000)];
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

  it("points are only real data: range start, value and flow days, range end", () => {
    const s = computeInvestmentSeries(input(), range);
    expect(s.points.map((p) => [p.date, p.valueMinor])).toEqual([
      ["2026-01-01", 0],
      ["2026-01-10", 100_000],
      ["2026-01-20", 110_000],
      ["2026-02-10", 160_000], // 110,000 held + the 50,000 buy (not estimated)
      ["2026-02-20", 170_000],
      ["2026-03-05", 140_000],
      ["2026-03-15", 140_000],
      ["2026-03-31", 140_000],
    ]);
    expect(s.points.filter((p) => p.entered).map((p) => p.date)).toEqual([
      "2026-01-20",
      "2026-02-20",
    ]);
    expect(s.points.find((p) => p.date === "2026-02-10")!.before).toEqual({
      investedMinor: 100_000,
      valueMinor: 110_000,
    });
    expect(s.points.find((p) => p.date === "2026-03-31")!.before).toBeNull();
  });

  it("a range starting between updates starts at the previous value (owner's d3 example)", () => {
    const d = [
      txn("opening_balance", "2026-01-01", 50_000),
      val("2026-01-01", 50_000),
      val("2026-01-03", 80_000),
      val("2026-01-05", 70_000),
    ];
    const s = computeInvestmentSeries(input({ holdingEvents: new Map([["a", d]]) }), {
      from: "2026-01-02",
      to: "2026-01-05",
    });
    expect(s.points.map((p) => [p.date, p.valueMinor, p.entered])).toEqual([
      ["2026-01-02", 50_000, false],
      ["2026-01-03", 80_000, true],
      ["2026-01-05", 70_000, true],
    ]);
    expect(s.baseline.valueMinor).toBe(50_000);
    expect(s.marketGainMinor).toBe(20_000);
  });

  it("summary: gain at the end, market gain without money in/out, income in the range", () => {
    const s = computeInvestmentSeries(input(), range);
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

  it("market gain inside a later range starts from the value held the day before", () => {
    const s = computeInvestmentSeries(input(), { from: "2026-02-01", to: "2026-02-28" });
    expect(s.baseline.valueMinor).toBe(110_000);
    expect(s.marketGainMinor).toBe(170_000 - 110_000 - 50_000);
    expect(s.incomeMinor).toBe(0);
  });

  it("fees and tax are a cost: Market gain − Gain = realised gain (owner decision, 2026-11-07)", () => {
    const one = (events: HoldingEvent[]) =>
      computeInvestmentSeries(input({ holdingEvents: new Map([["a", events]]) }), range);
    // A buy with a 25 fee: both say −25.
    let s = one([txn("invest", "2026-01-10", 100_000, { feeMinor: 25 })]);
    expect(s.end.gainMinor).toBe(-25);
    expect(s.marketGainMinor).toBe(-25);
    // Partial redemption with a fee: cost recovery realises 0, so both agree (19,875).
    s = one([
      txn("invest", "2026-01-10", 100_000, { feeMinor: 25 }),
      val("2026-01-20", 120_000),
      txn("redeem", "2026-02-10", 30_000, { feeMinor: 100 }),
    ]);
    expect(s.end).toMatchObject({ investedMinor: 70_125, valueMinor: 90_000, gainMinor: 19_875 });
    expect(s.marketGainMinor).toBe(19_875);
    // Full redemption: everything is realised (120,000 − 100,025 − 100); Gain is 0.
    s = one([
      txn("invest", "2026-01-10", 100_000, { feeMinor: 25 }),
      val("2026-01-20", 120_000),
      txn("redeem", "2026-02-10", 120_000, { feeMinor: 100 }),
    ]);
    expect(s.end.gainMinor).toBe(0);
    expect(s.marketGainMinor).toBe(19_875);
  });

  it("an opening balance counts its whole first-day value as money in", () => {
    const s = computeInvestmentSeries(
      input({
        holdingEvents: new Map([
          ["a", [txn("opening_balance", "2026-01-05", 100_000), val("2026-01-05", 130_000)]],
        ]),
      }),
      { from: "2026-01-01", to: "2026-01-31" },
    );
    expect(s.end).toMatchObject({ investedMinor: 100_000, valueMinor: 130_000, gainMinor: 30_000 });
    expect(s.marketGainMinor).toBe(0);
  });

  it("converts each holding on each date and leaves out a missing rate", () => {
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
    );
    expect(s.points.find((p) => p.date === "2026-01-10")!.valueMinor).toBe(100_000); // no USD rate yet
    expect(s.end.valueMinor).toBe(110_000 + 1_100 * 300);
    expect(s.fxMissing).toBe(0);
  });

  it("an empty scope is all zeros", () => {
    const s = computeInvestmentSeries(input({ holdings: [] }), range);
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
    );
    expect(s.points.map((p) => [p.date, p.entered])).toEqual([
      ["2026-01-01", false],
      ["2026-01-10", false],
      ["2026-01-20", true],
      ["2026-01-31", false],
    ]);
  });
});
