import { describe, expect, it } from "vitest";
import { parseMoneyToMinor } from "@/domain/money";
import { groupDigits, groupWhileTyping } from "@/lib/typing-format";

describe("groupWhileTyping (live thousands separators)", () => {
  it("groups the whole part and leaves decimals alone", () => {
    expect(groupDigits("1234567.891")).toBe("1,234,567.891");
    expect(groupDigits("21000.00")).toBe("21,000.00");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("1000")).toBe("1,000");
    expect(groupDigits("-12500.5")).toBe("-12,500.5");
    expect(groupDigits("0.5")).toBe("0.5");
    expect(groupDigits(".5")).toBe(".5");
    expect(groupDigits("")).toBe("");
  });

  it("drops stray characters, extra points and inner minus signs", () => {
    expect(groupDigits("1a2b3c4")).toBe("1,234");
    expect(groupDigits("1.2.3")).toBe("1.23");
    expect(groupDigits("12-34")).toBe("1,234");
    expect(groupDigits("1, 2 3 4")).toBe("1,234");
  });

  it("keeps the caret after the digit that was just typed", () => {
    // typed the 4th digit at the end: "123|" + "4" → "1,234|"
    expect(groupWhileTyping("1234", 4)).toEqual({ text: "1,234", caret: 5 });
    // inserted "9" after the "1" of "1,234": "19,234" text arrives as "19,234" with caret 2
    expect(groupWhileTyping("19,234", 2)).toEqual({ text: "19,234", caret: 2 });
    // inserted "5" in "12,345" after "12," → "12,5345" caret 4 → "125,345" caret 3
    expect(groupWhileTyping("12,5345", 4)).toEqual({ text: "125,345", caret: 3 });
    // deleted a digit: "1,23|4" minus "3" → "1,2|4" → "124" caret 2
    expect(groupWhileTyping("1,24", 3)).toEqual({ text: "124", caret: 2 });
    // caret at the start stays at the start
    expect(groupWhileTyping("1234", 0)).toEqual({ text: "1,234", caret: 0 });
  });

  it("produces text the money parser reads back to the same minor units", () => {
    for (const raw of ["1234567.89", "50000", "-1250.5", "0.07"]) {
      expect(parseMoneyToMinor(groupDigits(raw), "LKR")).toBe(parseMoneyToMinor(raw, "LKR"));
    }
  });
});
