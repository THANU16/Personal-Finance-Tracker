import { describe, expect, it } from "vitest";
import {
  add,
  allocateLargestRemainder,
  bpToPercentString,
  divRound,
  minorToDecimalString,
  minorUnitDigits,
  mulBp,
  mulDivRound,
  parseMoneyToMinor,
  parsePercentToBp,
  roundHalfAwayFromZero,
  sub,
} from "@/domain/money";

describe("add / sub", () => {
  it("adds and subtracts integers", () => {
    expect(add(100, 250, -50)).toBe(300);
    expect(add()).toBe(0);
    expect(sub(1000, 1250)).toBe(-250);
  });

  it.each([[1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])("rejects %s", (bad) => {
    expect(() => add(1, bad)).toThrow(RangeError);
    expect(() => sub(bad, 1)).toThrow(RangeError);
  });
});

describe("roundHalfAwayFromZero", () => {
  it.each([
    [2.5, 3],
    [-2.5, -3],
    [2.4999, 2],
    [-2.4999, -2],
    [0.5, 1],
    [-0.5, -1],
    [-0.4, 0],
    [7, 7],
  ])("%s → %s", (x, expected) => {
    expect(roundHalfAwayFromZero(x)).toBe(expected);
  });

  it("never returns -0", () => {
    expect(Object.is(roundHalfAwayFromZero(-0.2), 0)).toBe(true);
  });
});

describe("divRound", () => {
  it.each([
    [5, 2, 3],
    [-5, 2, -3],
    [5, -2, -3],
    [7, 3, 2],
    [8, 3, 3],
    [-8, 3, -3],
    [0, 7, 0],
    [10, 5, 2],
  ])("%s / %s → %s", (n, d, expected) => {
    expect(divRound(n, d)).toBe(expected);
  });

  it("rejects division by zero", () => {
    expect(() => divRound(1, 0)).toThrow(RangeError);
  });
});

describe("mulBp", () => {
  it.each([
    [100_000, 2_500, 25_000],
    [333, 5_000, 167], // 166.5 → 167
    [-333, 5_000, -167],
    [1, 4_999, 0],
    [1, 5_000, 1],
    [12_345_678, 10_000, 12_345_678],
    [0, 1_234, 0],
  ])("%s × %sbp → %s", (amount, bp, expected) => {
    expect(mulBp(amount, bp)).toBe(expected);
  });
});

describe("allocateLargestRemainder", () => {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  it.each([
    [100, [1, 1, 1], [34, 33, 33]],
    [100, [1, 2], [33, 67]],
    [2, [1, 1, 1], [1, 1, 0]], // ties → earlier item
    [10_000_000, [5_000, 3_000, 1_000, 1_000], [5_000_000, 3_000_000, 1_000_000, 1_000_000]],
    [0, [1, 2, 3], [0, 0, 0]],
    [7, [10_000], [7]],
    [5, [0, 1, 0], [0, 5, 0]],
    [-100, [1, 1, 1], [-34, -33, -33]],
  ])("splits %s by %j → %j", (total, weights, expected) => {
    const parts = allocateLargestRemainder(total, weights);
    expect(parts).toEqual(expected);
    expect(sum(parts)).toBe(total);
  });

  it("splits a class amount across assets (docs/04 §6 equity leg: 50,000.00 by 40/20/40)", () => {
    expect(allocateLargestRemainder(5_000_000, [4_000, 2_000, 4_000])).toEqual([
      2_000_000, 1_000_000, 2_000_000,
    ]);
  });

  it("gives leftovers to the largest remainders first", () => {
    // 11 by [3,3,4] → 3.3, 3.3, 4.4 → floors 3,3,4, leftover 1 → largest remainder (.4) at index 2
    expect(allocateLargestRemainder(11, [3, 3, 4])).toEqual([3, 3, 5]);
    // 12 by [3,3,4] → 3.6, 3.6, 4.8 → floors 3,3,4, leftover 2 → .8 (index 2), then tie .6 → index 0
    expect(allocateLargestRemainder(12, [3, 3, 4])).toEqual([4, 3, 5]);
    // 1 by [1,3] → 0.25, 0.75 → leftover to index 1
    expect(allocateLargestRemainder(1, [1, 3])).toEqual([0, 1]);
  });

  it("always sums exactly to the total (randomised)", () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    for (let run = 0; run < 500; run++) {
      const n = 1 + rand(8);
      const weights = Array.from({ length: n }, () => rand(10_001));
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const total = rand(100_000_000) - 20_000_000;
      const parts = allocateLargestRemainder(total, weights);
      expect(sum(parts)).toBe(total);
      parts.forEach((p, i) => {
        const exact = (total * weights[i]!) / sum(weights);
        expect(Math.abs(p - exact)).toBeLessThan(1);
      });
    }
  });

  it.each([
    ["empty weights", 10, []],
    ["all-zero weights", 10, [0, 0]],
    ["negative weight", 10, [1, -1]],
    ["fractional weight", 10, [1.5]],
    ["fractional total", 10.5, [1]],
  ])("rejects %s", (_label, total, weights) => {
    expect(() => allocateLargestRemainder(total, weights)).toThrow(RangeError);
  });
});

describe("minorUnitDigits", () => {
  it.each([
    ["LKR", 2],
    ["USD", 2],
    ["JPY", 0],
    ["BTC", 8],
    ["lkr", 2],
  ])("%s → %s", (code, digits) => {
    expect(minorUnitDigits(code)).toBe(digits);
  });

  it("rejects an invalid code", () => {
    expect(() => minorUnitDigits("NOPE1")).toThrow(RangeError);
  });
});

describe("parseMoneyToMinor", () => {
  it.each([
    ["1,250.5", "LKR", 125_050],
    ["1250.50", "LKR", 125_050],
    ["1,250,000", "LKR", 125_000_000],
    ["-3", "LKR", -300],
    ["+3", "LKR", 300],
    [".5", "LKR", 50],
    ["7.", "LKR", 700],
    [" 12.34 ", "USD", 1_234],
    ["1500", "JPY", 1_500],
    ["0.00000001", "BTC", 1],
    ["-0", "LKR", 0],
  ])("%s (%s) → %s", (text, currency, expected) => {
    expect(parseMoneyToMinor(text, currency)).toBe(expected);
  });

  it("returns null for empty input", () => {
    expect(parseMoneyToMinor("", "LKR")).toBeNull();
    expect(parseMoneyToMinor("   ", "LKR")).toBeNull();
  });

  it.each([
    ["0.001", "LKR"],
    ["1.5", "JPY"],
    ["abc", "LKR"],
    ["1,25.00", "LKR"],
    ["1.2.3", "LKR"],
    ["-", "LKR"],
    [".", "LKR"],
    ["1e5", "LKR"],
    ["99999999999999999", "LKR"],
  ])("rejects %s (%s)", (text, currency) => {
    expect(() => parseMoneyToMinor(text, currency)).toThrow(RangeError);
  });
});

describe("parsePercentToBp / bpToPercentString", () => {
  it.each([
    ["12.5", 1_250],
    ["12.05", 1_205],
    ["100", 10_000],
    ["0", 0],
    ["5%", 500],
    ["-2.5", -250],
  ])("%s → %sbp", (text, bp) => {
    expect(parsePercentToBp(text)).toBe(bp);
  });

  it("rejects more than 2 decimals and junk", () => {
    expect(() => parsePercentToBp("12.345")).toThrow(RangeError);
    expect(() => parsePercentToBp("abc")).toThrow(RangeError);
    expect(parsePercentToBp("")).toBeNull();
  });

  it.each([
    [1_250, "12.5"],
    [1_205, "12.05"],
    [10_000, "100"],
    [0, "0"],
    [-250, "-2.5"],
    [7, "0.07"],
  ])("%sbp → %s", (bp, text) => {
    expect(bpToPercentString(bp)).toBe(text);
    expect(parsePercentToBp(text)).toBe(bp);
  });
});

describe("minorToDecimalString", () => {
  it.each([
    [125_050, "LKR", "1250.50"],
    [-5, "LKR", "-0.05"],
    [0, "LKR", "0.00"],
    [1_500, "JPY", "1500"],
    [1, "BTC", "0.00000001"],
  ])("%s %s → %s", (minor, currency, expected) => {
    expect(minorToDecimalString(minor, currency)).toBe(expected);
  });

  it("round-trips with parseMoneyToMinor", () => {
    for (const v of [0, 1, -1, 99, 100, 123_456_789, -987_654]) {
      expect(parseMoneyToMinor(minorToDecimalString(v, "LKR"), "LKR")).toBe(v);
    }
  });
});

describe("mulDivRound", () => {
  it.each([
    [40_000, 20_000, 50_000, 16_000],
    [1, 1, 3, 0],
    [2, 1, 3, 1],
    [1, 1, 2, 1], // .5 → away from zero
    [-1, 1, 2, -1],
    [5, -3, 2, -8], // -7.5 → -8
    [0, 99, 7, 0],
  ])("%s × %s / %s → %s", (a, b, c, expected) => {
    expect(mulDivRound(a, b, c)).toBe(expected);
  });

  it("stays exact when the product exceeds 2^53", () => {
    // 900 billion × 700 billion / 1,000 billion — float math would be off
    expect(mulDivRound(900_000_000_000, 700_000_000_000, 1_000_000_000_000)).toBe(630_000_000_000);
    expect(mulDivRound(123_456_789_012_345, 3, 7)).toBe(52_910_052_433_862);
  });

  it("rejects division by zero and non-integers", () => {
    expect(() => mulDivRound(1, 1, 0)).toThrow(RangeError);
    expect(() => mulDivRound(1.5, 1, 1)).toThrow(RangeError);
  });
});

describe("allocateLargestRemainder with large totals × weights (BigInt path)", () => {
  it("stays exact when total × weight sum exceeds 2^53 (Rebalance crash on LKR 2.7M)", async () => {
    const { allocateLargestRemainder } = await import("@/domain/money");
    const total = 272_788_625;
    const weights = [6_000 * 5_000, 6_000 * 5_000, 3_000 * 10_000, 1_000 * 10_000];
    const parts = allocateLargestRemainder(total, weights);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(parts).toEqual([81_836_588, 81_836_588, 81_836_587, 27_278_862]); // ties → earlier items
    expect(allocateLargestRemainder(-total, weights).reduce((a, b) => a + b, 0)).toBe(-total);
    // Same answer as the small path where both apply.
    expect(allocateLargestRemainder(1_000, [3, 3, 3])).toEqual([334, 333, 333]);
  });
});
