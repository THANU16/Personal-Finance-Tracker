import { describe, expect, it } from "vitest";
import { redeemByAmount, redeemByUnits, roundUnits, unitsValueMinor } from "@/domain/redemption";

describe("redeemByAmount (cost recovery, docs/04 §3)", () => {
  it("owner example: 660,000 / 672,365 / redeem 400,000 → capital back, nothing realised", () => {
    const r = redeemByAmount({
      investedMinor: 66_000_000,
      currentValueMinor: 67_236_500,
      amountMinor: 40_000_000,
    });
    expect(r).toMatchObject({
      costRemovedMinor: 40_000_000,
      realizedGainMinor: 0,
      remainingInvestedMinor: 26_000_000,
      remainingValueMinor: 27_236_500,
      full: false,
    });
    const rest = redeemByAmount({
      investedMinor: 26_000_000,
      currentValueMinor: 27_236_500,
      amountMinor: 27_236_500,
    });
    expect(rest).toMatchObject({
      costRemovedMinor: 26_000_000,
      realizedGainMinor: 1_236_500,
      full: true,
      remainingInvestedMinor: 0,
    });
  });

  it("the fee reduces the cost recovered: 40,000 / 50,000 / redeem 20,000 / fee 100", () => {
    const r = redeemByAmount({
      investedMinor: 4_000_000,
      currentValueMinor: 5_000_000,
      amountMinor: 2_000_000,
      feeMinor: 10_000,
    });
    expect(r.costRemovedMinor).toBe(1_990_000); // net 19,900
    expect(r.realizedGainMinor).toBe(0);
    expect(r.cashToAccountMinor).toBe(1_990_000);
    expect(r.remainingInvestedMinor).toBe(2_010_000);
    expect(r.remainingValueMinor).toBe(3_000_000);
  });

  it("withholds tax from the cash only, not from the cost or the gain", () => {
    const r = redeemByAmount({
      investedMinor: 4_000_000,
      currentValueMinor: 5_000_000,
      amountMinor: 2_000_000,
      feeMinor: 10_000,
      taxMinor: 5_000,
    });
    expect(r.costRemovedMinor).toBe(1_990_000);
    expect(r.realizedGainMinor).toBe(0);
    expect(r.cashToAccountMinor).toBe(1_985_000);
  });

  it("realises the part beyond the capital still invested", () => {
    const r = redeemByAmount({
      investedMinor: 1_000_000,
      currentValueMinor: 3_000_000,
      amountMinor: 1_500_000,
    });
    expect(r).toMatchObject({
      costRemovedMinor: 1_000_000,
      realizedGainMinor: 500_000,
      remainingInvestedMinor: 0,
      remainingValueMinor: 1_500_000,
    });
    const after = redeemByAmount({
      investedMinor: 0,
      currentValueMinor: 1_500_000,
      amountMinor: 500_000,
    });
    expect(after).toMatchObject({ costRemovedMinor: 0, realizedGainMinor: 500_000 });
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

  it("a loss is realised only on the full redemption", () => {
    const partial = redeemByAmount({
      investedMinor: 1_000_000,
      currentValueMinor: 800_000,
      amountMinor: 400_000,
    });
    expect(partial).toMatchObject({
      costRemovedMinor: 400_000,
      realizedGainMinor: 0,
      remainingInvestedMinor: 600_000,
    });
    const full = redeemByAmount({
      investedMinor: 600_000,
      currentValueMinor: 400_000,
      amountMinor: 400_000,
      feeMinor: 1_000,
    });
    expect(full).toMatchObject({
      costRemovedMinor: 600_000,
      realizedGainMinor: -201_000,
      full: true,
    });
  });

  it("removes units in proportion to the value sold on tracked holdings", () => {
    const r = redeemByAmount({
      investedMinor: 100_000,
      currentValueMinor: 200_000,
      amountMinor: 50_000,
      unitsHeld: 1_000,
    });
    expect(r.unitsRemoved).toBe(250);
    expect(r.costRemovedMinor).toBe(50_000);
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
  it("sells units at the price; the proceeds recover cost first", () => {
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
    expect(r.costRemovedMinor).toBe(3_086_418); // cost recovery: capital back first
    expect(r.realizedGainMinor).toBe(0);
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
