import { describe, expect, it } from "vitest";
import { redeemByAmount, redeemByUnits, roundUnits, unitsValueMinor } from "@/domain/redemption";

describe("redeemByAmount (proportional cost, docs/04 §3)", () => {
  it("matches the worked example: 40,000 / 50,000 / redeem 20,000 / fee 100", () => {
    // minor units (cents)
    const r = redeemByAmount({
      investedMinor: 4_000_000,
      currentValueMinor: 5_000_000,
      amountMinor: 2_000_000,
      feeMinor: 10_000,
    });
    expect(r.costRemovedMinor).toBe(1_600_000); // share 40%
    expect(r.realizedGainMinor).toBe(390_000); // 3,900
    expect(r.cashToAccountMinor).toBe(1_990_000); // 19,900
    expect(r.remainingInvestedMinor).toBe(2_400_000); // 24,000
    expect(r.remainingValueMinor).toBe(3_000_000); // 30,000
    expect(r.full).toBe(false);
  });

  it("withholds tax from the cash only, not from the gain", () => {
    const r = redeemByAmount({
      investedMinor: 4_000_000,
      currentValueMinor: 5_000_000,
      amountMinor: 2_000_000,
      feeMinor: 10_000,
      taxMinor: 5_000,
    });
    expect(r.realizedGainMinor).toBe(390_000);
    expect(r.cashToAccountMinor).toBe(1_985_000);
  });

  it("rounds the cost removed half away from zero", () => {
    // 100 × 1/3 = 33.33 → 33; 200 × 1/3 = 66.67 → 67
    expect(
      redeemByAmount({ investedMinor: 100, currentValueMinor: 300, amountMinor: 100 })
        .costRemovedMinor,
    ).toBe(33);
    expect(
      redeemByAmount({ investedMinor: 200, currentValueMinor: 300, amountMinor: 100 })
        .costRemovedMinor,
    ).toBe(67);
    expect(
      redeemByAmount({ investedMinor: 1, currentValueMinor: 2, amountMinor: 1 }).costRemovedMinor,
    ).toBe(1);
  });

  it.each([
    ["exact value", 5_000_000],
    ["more than the value", 6_000_000],
  ])("treats %s as a full redemption", (_l, amount) => {
    const r = redeemByAmount({
      investedMinor: 4_000_000,
      currentValueMinor: 5_000_000,
      amountMinor: amount,
    });
    expect(r.full).toBe(true);
    expect(r.costRemovedMinor).toBe(4_000_000);
    expect(r.remainingInvestedMinor).toBe(0);
    expect(r.remainingValueMinor).toBe(0);
    expect(r.realizedGainMinor).toBe(amount - 4_000_000);
  });

  it("handles a loss", () => {
    const r = redeemByAmount({
      investedMinor: 1_000_000,
      currentValueMinor: 800_000,
      amountMinor: 400_000,
    });
    expect(r.costRemovedMinor).toBe(500_000);
    expect(r.realizedGainMinor).toBe(-100_000);
  });

  it("removes units proportionally on tracked holdings", () => {
    const r = redeemByAmount({
      investedMinor: 100_000,
      currentValueMinor: 200_000,
      amountMinor: 50_000,
      unitsHeld: 1_000,
    });
    expect(r.unitsRemoved).toBe(250);
  });

  it.each([
    ["zero value", { investedMinor: 1, currentValueMinor: 0, amountMinor: 1 }],
    ["zero amount", { investedMinor: 1, currentValueMinor: 1, amountMinor: 0 }],
    [
      "fee above amount",
      { investedMinor: 1, currentValueMinor: 100, amountMinor: 10, feeMinor: 11 },
    ],
    ["negative tax", { investedMinor: 1, currentValueMinor: 100, amountMinor: 10, taxMinor: -1 }],
  ])("rejects %s", (_l, input) => {
    expect(() => redeemByAmount(input)).toThrow(RangeError);
  });
});

describe("redeemByUnits", () => {
  it("sells units at the price and removes cost by unit share", () => {
    // 1,000 units, invested 100,000.00; sell 250 units at 123.4567 → amount 30,864.18
    const r = redeemByUnits({
      investedMinor: 10_000_000,
      currentValueMinor: 12_345_670,
      unitsHeld: 1_000,
      unitsSold: 250,
      priceMinorE4: 123_456_700, // 12,345.67 minor × 10⁴ → 123.4567 major
      feeMinor: 0,
    });
    expect(r.amountMinor).toBe(3_086_418); // 250 × 12,345.67 = 3,086,417.5 → 3,086,418
    expect(r.costRemovedMinor).toBe(2_500_000);
    expect(r.realizedGainMinor).toBe(586_418);
    expect(r.unitsRemoved).toBe(250);
    expect(r.full).toBe(false);
  });

  it("is full when all units are sold", () => {
    const r = redeemByUnits({
      investedMinor: 999,
      currentValueMinor: 1_200,
      unitsHeld: 10.5,
      unitsSold: 10.5,
      priceMinorE4: (1_200_000 / 10.5) | 0,
    });
    expect(r.full).toBe(true);
    expect(r.costRemovedMinor).toBe(999);
  });

  it("rejects selling more units than held", () => {
    expect(() =>
      redeemByUnits({
        investedMinor: 1,
        currentValueMinor: 1,
        unitsHeld: 1,
        unitsSold: 1.5,
        priceMinorE4: 10_000,
      }),
    ).toThrow(RangeError);
  });
});

describe("unit helpers", () => {
  it("rounds units to 6 decimals and values them exactly", () => {
    expect(roundUnits(0.1 + 0.2)).toBe(0.3);
    expect(roundUnits(1.23456789)).toBe(1.234568);
    // 10,000 units × NAV 12.3456 (=1234.56 minor = 12,345,600 ×10⁻⁴) = 123,456.00
    expect(unitsValueMinor(10_000, 12_345_600)).toBe(12_345_600);
  });
});
