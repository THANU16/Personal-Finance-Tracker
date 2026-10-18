import { describe, expect, it } from "vitest";
import { fdValue, type FdTerms } from "@/domain/fd";
import {
  holdingCashFlows,
  isBigChange,
  isStale,
  replayHolding,
  totalReturnMinor,
  unrealizedGainMinor,
  type HoldingEvent,
} from "@/domain/holdings";
import { xirr } from "@/domain/returns";

let seq = 0;
const txn = (
  type: "opening_balance" | "invest" | "redeem" | "investment_income",
  date: string,
  amountMinor: number,
  extra: Partial<Extract<HoldingEvent, { kind: "txn" }>> = {},
): HoldingEvent => ({ kind: "txn", id: `t${++seq}`, type, date, seq, amountMinor, ...extra });
const val = (
  date: string,
  valueMinor: number,
  extra: Partial<Extract<HoldingEvent, { kind: "valuation" }>> = {},
): HoldingEvent => ({
  kind: "valuation",
  id: `v${++seq}`,
  date,
  seq,
  valueMinor,
  ...extra,
});

describe("replayHolding (docs/04 §3 table)", () => {
  it("opening balance + valuation, buy, redeem (worked example), income paid and reinvested", () => {
    const redeemEvt = txn("redeem", "2026-03-01", 2_000_000, { feeMinor: 10_000, taxMinor: 0 });
    const { state, redemptions } = replayHolding(
      [
        txn("opening_balance", "2026-01-01", 3_000_000),
        val("2026-01-01", 4_000_000),
        txn("invest", "2026-02-01", 1_000_000, { feeMinor: 0 }), // invested 40,000; value 50,000
        redeemEvt,
        txn("investment_income", "2026-04-01", 50_000, { taxMinor: 7_000 }),
        txn("investment_income", "2026-05-01", 20_000, { taxMinor: 2_000, reinvest: true }),
      ],
      { trackUnits: false },
    );
    // Cost recovery: the fee-net 19,900 comes back as capital; nothing is realised yet.
    expect(redemptions.get(redeemEvt.id)).toMatchObject({
      costRemovedMinor: 1_990_000,
      realizedGainMinor: 0,
      cashToAccountMinor: 1_990_000,
    });
    expect(state).toMatchObject({
      investedMinor: 2_010_000 + 18_000,
      currentValueMinor: 3_000_000 + 18_000,
      realizedGainMinor: 0,
      incomeReceivedMinor: 70_000,
      taxWithheldMinor: 9_000,
      feesPaidMinor: 10_000,
      firstInvestedAt: "2026-01-01",
      lastValuedAt: "2026-01-01",
      fullyRedeemed: false,
    });
    expect(unrealizedGainMinor(state)).toBe(990_000);
    // total = unrealised 990,000 + realised 0 + income 70,000 − tax 9,000 (same total as before)
    expect(totalReturnMinor(state)).toBe(1_051_000);
  });

  it("counts buy fees in invested but not in value", () => {
    const { state } = replayHolding([txn("invest", "2026-01-01", 100_000, { feeMinor: 1_500 })], {
      trackUnits: false,
    });
    expect(state.investedMinor).toBe(101_500);
    expect(state.currentValueMinor).toBe(100_000);
    expect(state.feesPaidMinor).toBe(1_500);
  });

  it("value = latest valuation + later flows; same day follows entry order", () => {
    const { state, timeline } = replayHolding(
      [
        txn("invest", "2026-01-10", 100_000),
        txn("invest", "2026-02-01", 50_000), // entered before the same-day valuation → inside it
        val("2026-02-01", 170_000),
        txn("invest", "2026-02-01", 5_000), // entered after it on the same day → adds to it
        txn("invest", "2026-03-01", 20_000), // later date → adds to it
      ],
      { trackUnits: false },
    );
    expect(state.currentValueMinor).toBe(195_000);
    expect(state.investedMinor).toBe(175_000);
    expect(timeline.map((p) => [p.date, p.valueMinor])).toEqual([
      ["2026-01-10", 100_000],
      ["2026-02-01", 175_000],
      ["2026-03-01", 195_000],
    ]);
  });

  it("add a holding today, then buy today: the buy shows in the value", () => {
    const { state } = replayHolding(
      [
        txn("opening_balance", "2026-10-18", 3_000_000),
        val("2026-10-18", 4_000_000),
        txn("invest", "2026-10-18", 1_000_000),
      ],
      { trackUnits: false },
    );
    expect(state.currentValueMinor).toBe(5_000_000);
  });

  it("value today, then redeem today: the redemption uses the new value", () => {
    // Events are created (= entered) in this order: buy, valuation, redemption.
    const buy = txn("invest", "2025-01-01", 1_000_000);
    const valuation = val("2026-10-18", 1_100_000);
    const redeem = txn("redeem", "2026-10-18", 1_100_000);
    const { state, redemptions } = replayHolding([redeem, valuation, buy], { trackUnits: false });
    expect(redemptions.get(redeem.id)?.full).toBe(true);
    expect(state).toMatchObject({ currentValueMinor: 0, realizedGainMinor: 100_000 });
  });

  it("a backdated buy changes a later redemption's cost and gain", () => {
    const redeem = txn("redeem", "2026-03-01", 150_000);
    const without = replayHolding(
      [txn("invest", "2026-01-01", 100_000), val("2026-02-01", 200_000), redeem],
      { trackUnits: false },
    );
    // invested 100,000, value 200,000: 150,000 out → 100,000 capital back, 50,000 realised
    expect(without.redemptions.get(redeem.id)).toMatchObject({
      costRemovedMinor: 100_000,
      realizedGainMinor: 50_000,
    });
    const withBackdated = replayHolding(
      [
        txn("invest", "2026-01-01", 100_000),
        val("2026-02-01", 200_000),
        txn("invest", "2026-02-15", 100_000, { feeMinor: 10_000 }),
        redeem,
      ],
      { trackUnits: false },
    );
    // invested 210,000 → all 150,000 is capital back, nothing realised
    expect(withBackdated.redemptions.get(redeem.id)).toMatchObject({
      costRemovedMinor: 150_000,
      realizedGainMinor: 0,
    });
  });

  it("cost recovery (owner example): partial redemptions return capital; the full one realises the gain", () => {
    const partial = txn("redeem", "2026-03-01", 40_000_000);
    const full = txn("redeem", "2026-04-01", 27_236_500);
    const { state, redemptions } = replayHolding(
      [txn("invest", "2026-01-01", 66_000_000), val("2026-02-01", 67_236_500), partial, full],
      { trackUnits: false },
    );
    expect(redemptions.get(partial.id)).toMatchObject({
      costRemovedMinor: 40_000_000,
      realizedGainMinor: 0,
      remainingInvestedMinor: 26_000_000,
      remainingValueMinor: 27_236_500,
    });
    expect(redemptions.get(full.id)).toMatchObject({
      costRemovedMinor: 26_000_000,
      realizedGainMinor: 1_236_500,
      full: true,
    });
    expect(state).toMatchObject({
      investedMinor: 0,
      currentValueMinor: 0,
      realizedGainMinor: 1_236_500,
    });
  });

  it("tracks units: value = units × last price, average cost, redeem by units", () => {
    // prices are minor units × 10⁴: 100.00 = 10,000 minor → 100,000,000
    const sell = txn("redeem", "2026-03-01", 0, { units: 40, priceMinorE4: 120_000_000 }); // 40 × 120.00
    const { state, redemptions } = replayHolding(
      [
        txn("invest", "2026-01-01", 1_000_000, {
          units: 100,
          priceMinorE4: 100_000_000,
          feeMinor: 2_000,
        }), // 100 @ 100.00
        val("2026-02-01", 0, { priceMinorE4: 110_000_000 }), // NAV 110.00
        sell,
      ],
      { trackUnits: true },
    );
    expect(redemptions.get(sell.id)).toMatchObject({
      amountMinor: 480_000,
      costRemovedMinor: 480_000, // cost recovery: the sale returns capital first
      realizedGainMinor: 0,
    });
    expect(state.units).toBe(60);
    expect(state.investedMinor).toBe(522_000); // 1,002,000 − 480,000
    expect(state.currentValueMinor).toBe(720_000); // 60 × 120.00 (last price from the sale)
    expect(state.avgCostMinor).toBe(8_700); // 522,000 / 60
  });

  it("full redemption leaves zero value and zero invested", () => {
    const { state } = replayHolding(
      [
        txn("invest", "2026-01-01", 100_000),
        val("2026-02-01", 130_000),
        txn("redeem", "2026-03-01", 130_000),
      ],
      { trackUnits: false },
    );
    expect(state).toMatchObject({
      investedMinor: 0,
      currentValueMinor: 0,
      realizedGainMinor: 30_000,
      fullyRedeemed: true,
    });
  });

  it("FD holdings take value from the deposit terms", () => {
    const terms: FdTerms = {
      principalMinor: 100_000_000,
      rateBp: 1_000,
      startDate: "2026-01-01",
      maturityDate: "2027-01-01",
      compounding: "simple",
      payout: "at_maturity",
    };
    const valueAt = (d: string) => fdValue(terms, d);
    const live = replayHolding([txn("opening_balance", "2026-01-01", 100_000_000)], {
      trackUnits: false,
      valueAt,
      until: "2026-03-15",
    });
    expect(live.state.currentValueMinor).toBe(102_000_000);
    const withdrawn = replayHolding(
      [txn("opening_balance", "2026-01-01", 100_000_000), txn("redeem", "2027-01-01", 110_000_000)],
      { trackUnits: false, valueAt, until: "2027-02-01" },
    );
    expect(withdrawn.state).toMatchObject({
      currentValueMinor: 0,
      realizedGainMinor: 10_000_000,
      fullyRedeemed: true,
    });
    // Early withdrawal with a penalty: the bank pays less than the calculated value; still the whole FD
    const early = replayHolding(
      [txn("opening_balance", "2026-01-01", 100_000_000), txn("redeem", "2026-07-01", 103_000_000)],
      { trackUnits: false, valueAt, until: "2026-08-01" },
    );
    expect(early.state).toMatchObject({
      investedMinor: 0,
      currentValueMinor: 0,
      realizedGainMinor: 3_000_000,
      fullyRedeemed: true,
    });
  });
});

describe("holdingCashFlows → XIRR (docs/04 §5)", () => {
  it("builds investor flows with a terminal value", () => {
    const events = [
      txn("opening_balance", "2025-01-01", 500_000),
      txn("invest", "2025-02-01", 100_000, { feeMinor: 1_000 }),
      txn("redeem", "2025-06-01", 50_000, { feeMinor: 500, taxMinor: 200 }),
      txn("investment_income", "2025-07-01", 10_000, { taxMinor: 1_400 }),
      txn("investment_income", "2025-08-01", 3_000, { reinvest: true }),
    ];
    expect(holdingCashFlows(events, { date: "2026-01-01", valueMinor: 700_000 })).toEqual([
      { date: "2025-01-01", amountMinor: -500_000 },
      { date: "2025-02-01", amountMinor: -101_000 },
      { date: "2025-06-01", amountMinor: 49_300 },
      { date: "2025-07-01", amountMinor: 8_600 },
      { date: "2026-01-01", amountMinor: 700_000 },
    ]);
  });

  it("gives ≈ 10% for one buy held a year at +10%", () => {
    const flows = holdingCashFlows([txn("invest", "2025-01-01", 1_000_000)], {
      date: "2026-01-01",
      valueMinor: 1_100_000,
    });
    expect(xirr(flows)).toBeCloseTo(0.1, 4);
  });
});

describe("valuation safeguards (docs/04 §12)", () => {
  const base = {
    active: true,
    isFd: false,
    currentValueMinor: 1,
    lastValuedAt: "2026-09-18",
    today: "2026-10-18",
    staleDays: 30,
  };
  it.each([
    ["exactly 30 days old", {}, false],
    ["31 days old", { lastValuedAt: "2026-09-17" }, true],
    ["never valued", { lastValuedAt: null }, true],
    ["closed", { active: false, lastValuedAt: "2020-01-01" }, false],
    ["an FD", { isFd: true, lastValuedAt: "2020-01-01" }, false],
    ["worth nothing", { currentValueMinor: 0, lastValuedAt: "2020-01-01" }, false],
  ])("%s → stale %s", (_l, override, expected) => {
    expect(isStale({ ...base, ...override })).toBe(expected);
  });

  it.each([
    [100_000, 120_000, 2_000, false], // exactly 20%
    [100_000, 120_001, 2_000, true],
    [100_000, 79_999, 2_000, true],
    [100_000, 80_000, 2_000, false],
    [0, 1, 2_000, true],
    [0, 0, 2_000, false],
  ])("%s → %s at %sbp: big %s", (oldV, newV, bp, expected) => {
    expect(isBigChange(oldV, newV, bp)).toBe(expected);
  });
});
