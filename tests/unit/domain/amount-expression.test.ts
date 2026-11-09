import { describe, expect, it } from "vitest";
import {
  applyKeypadKey,
  evaluateAmountExpression,
  isCalculation,
  minorToKeypad,
  type KeypadKey,
} from "@/domain/amount-expression";

const type = (keys: KeypadKey[], digits = 2) =>
  keys.reduce((e, k) => applyKeypadKey(e, k, digits), "");

describe("evaluateAmountExpression", () => {
  it("adds, subtracts and keeps × ÷ before + −", () => {
    expect(evaluateAmountExpression("1250+340", 2)).toBe(159_000);
    expect(evaluateAmountExpression("1000-250.5", 2)).toBe(74_950);
    expect(evaluateAmountExpression("100+2*3", 2)).toBe(10_600);
    expect(evaluateAmountExpression("2*3.5", 2)).toBe(700);
  });

  it("is exact in minor units (no float drift)", () => {
    expect(evaluateAmountExpression("0.1+0.2", 2)).toBe(30);
    expect(evaluateAmountExpression("1.15*3", 2)).toBe(345);
  });

  it("rounds division half away from zero to the minor unit", () => {
    expect(evaluateAmountExpression("100/3", 2)).toBe(3_333);
    expect(evaluateAmountExpression("200/3", 2)).toBe(6_667);
    expect(evaluateAmountExpression("100/3", 0)).toBe(33);
  });

  it("ignores a trailing operator or point and refuses bad input", () => {
    expect(evaluateAmountExpression("12+", 2)).toBe(1_200);
    expect(evaluateAmountExpression("12.", 2)).toBe(1_200);
    expect(evaluateAmountExpression("", 2)).toBeNull();
    expect(evaluateAmountExpression("5/0", 2)).toBeNull();
    expect(evaluateAmountExpression("1.234", 2)).toBeNull();
    expect(evaluateAmountExpression("abc", 2)).toBeNull();
  });

  it("can go negative (the form refuses it)", () => {
    expect(evaluateAmountExpression("10-20", 2)).toBe(-1_000);
  });

  it("refuses results beyond the safe integer range", () => {
    expect(evaluateAmountExpression("999999999999*999999999999", 2)).toBeNull();
  });
});

describe("applyKeypadKey", () => {
  it("builds a sum and replaces a doubled operator", () => {
    expect(type(["1", "2", "5", "0", "+", "3", "4", "0"])).toBe("1250+340");
    expect(type(["5", "+", "*", "2"])).toBe("5*2");
  });

  it("refuses a leading operator, a second point and a third decimal", () => {
    expect(type(["+", "5"])).toBe("5");
    expect(type(["1", ".", "5", "."])).toBe("1.5");
    expect(type(["1", ".", "2", "5", "9"])).toBe("1.25");
    expect(type(["1", ".", "2", "00"])).toBe("1.20");
  });

  it("starts a bare point with 0 and drops leading zeros", () => {
    expect(type(["."])).toBe("0.");
    expect(type(["0", "7"])).toBe("7");
    expect(type(["00"])).toBe("0");
    expect(type(["0", "00"])).toBe("0");
  });

  it("has no point for currencies without minor units", () => {
    expect(type(["1", ".", "5"], 0)).toBe("15");
  });

  it("deletes one character and clears", () => {
    expect(type(["1", "2", "back"])).toBe("1");
    expect(type(["1", "+", "2", "clear"])).toBe("");
  });

  it("caps the integer part at 12 digits", () => {
    const keys: KeypadKey[] = Array.from({ length: 14 }, () => "9");
    expect(type(keys)).toBe("999999999999");
  });
});

describe("helpers", () => {
  it("isCalculation only when an operator sits between numbers", () => {
    expect(isCalculation("12+3")).toBe(true);
    expect(isCalculation("12+")).toBe(false);
    expect(isCalculation("12")).toBe(false);
  });

  it("minorToKeypad gives the plain starting text", () => {
    expect(minorToKeypad(159_000, 2)).toBe("1590");
    expect(minorToKeypad(12_345, 2)).toBe("123.45");
    expect(minorToKeypad(5, 2)).toBe("0.05");
    expect(minorToKeypad(120, 2)).toBe("1.2");
    expect(minorToKeypad(null, 2)).toBe("");
    expect(minorToKeypad(42, 0)).toBe("42");
  });
});
