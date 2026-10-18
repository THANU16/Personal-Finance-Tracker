import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatMoney,
  formatPercentBp,
  formatPrice,
  formatUnits,
} from "@/lib/format";

describe("formatMoney", () => {
  it.each([
    [125_000_000, "LKR", "LKR 1,250,000.00"],
    [-125_000, "LKR", "-LKR 1,250.00"],
    [0, "LKR", "LKR 0.00"],
    [5, "LKR", "LKR 0.05"],
    [1_999, "USD", "USD 19.99"],
    [150_000, "JPY", "JPY 150,000"],
    [12_345_678, "BTC", "BTC 0.12345678"],
    [900_719_925_474_099, "LKR", "LKR 9,007,199,254,740.99"], // exact near MAX_SAFE_INTEGER
  ])("%s %s → %s", (minor, currency, expected) => {
    expect(formatMoney(minor, currency)).toBe(expected);
  });

  it("adds + for signed positives only", () => {
    expect(formatMoney(100, "LKR", { signed: true })).toBe("+LKR 1.00");
    expect(formatMoney(-100, "LKR", { signed: true })).toBe("-LKR 1.00");
    expect(formatMoney(0, "LKR", { signed: true })).toBe("LKR 0.00");
  });
});

describe("formatCompact", () => {
  it.each([
    [125_000_000, "LKR 1.25M"],
    [-125_000_000, "-LKR 1.25M"],
    [9_950_000, "LKR 99.5K"],
    [99_900, "LKR 999"],
    [250_000_000_000, "LKR 2.5B"],
  ])("%s → %s", (minor, expected) => {
    expect(formatCompact(minor, "LKR")).toBe(expected);
  });
});

describe("formatPercentBp", () => {
  it.each([
    [1_234, "12.3%"],
    [1_235, "12.4%"], // half away from zero
    [-1_235, "-12.4%"],
    [10_000, "100.0%"],
    [5, "0.1%"],
    [4, "0.0%"],
    [-4, "0.0%"],
    [0, "0.0%"],
  ])("%s → %s", (bp, expected) => {
    expect(formatPercentBp(bp)).toBe(expected);
  });

  it("adds + when signed", () => {
    expect(formatPercentBp(250, { signed: true })).toBe("+2.5%");
    expect(formatPercentBp(-250, { signed: true })).toBe("-2.5%");
  });

  it("rejects non-integer bp", () => {
    expect(() => formatPercentBp(1.5)).toThrow(RangeError);
  });
});

describe("formatPrice / formatUnits", () => {
  it("shows NAV precision without trailing zeros", () => {
    expect(formatPrice(12_345_600, "LKR")).toBe("LKR 12.3456");
    expect(formatPrice(120_000_000, "LKR")).toBe("LKR 120.00");
    expect(formatPrice(1_234_567_890, "LKR")).toBe("LKR 1,234.56789"); // 6 decimals max for LKR
  });

  it("groups units and keeps up to 6 decimals", () => {
    expect(formatUnits(1234.5678)).toBe("1,234.5678");
    expect(formatUnits(0.000001)).toBe("0.000001");
  });
});
