import { describe, expect, it } from "vitest";
import { isValidPattern, matchCategory, type RuleLike } from "@/domain/category-rules";

const rule = (p: Partial<RuleLike>): RuleLike => ({
  matchField: "description",
  operator: "contains",
  pattern: "x",
  categoryId: "c",
  categoryKind: "expense",
  priority: 10,
  ...p,
});
const row = (description: string, amountMinor = -100, counterparty: string | null = null) => ({
  description,
  amountMinor,
  counterparty,
});

describe("matchCategory", () => {
  it("contains / equals ignore case; regex is case-insensitive", () => {
    expect(
      matchCategory([rule({ pattern: "KEELLS", categoryId: "food" })], row("Keells Super"))
        ?.categoryId,
    ).toBe("food");
    expect(
      matchCategory([rule({ operator: "equals", pattern: "uber" })], row("Uber trip")),
    ).toBeNull();
    expect(
      matchCategory([rule({ operator: "equals", pattern: "uber" })], row("UBER")),
    ).not.toBeNull();
    expect(
      matchCategory([rule({ operator: "regex", pattern: "^pickme\\s+\\d+" })], row("PickMe 123")),
    ).not.toBeNull();
  });

  it("priority first, then list order; kind must match the money direction", () => {
    const rules = [
      rule({ pattern: "shop", categoryId: "late", priority: 20 }),
      rule({ pattern: "shop", categoryId: "early", priority: 5 }),
      rule({ pattern: "shop", categoryId: "income", categoryKind: "income", priority: 1 }),
    ];
    expect(matchCategory(rules, row("Shop"))?.categoryId).toBe("early");
    expect(matchCategory(rules, row("Shop", 500))?.categoryId).toBe("income");
  });

  it("counterparty field; invalid regex never matches", () => {
    const cp = [rule({ matchField: "counterparty", pattern: "dialog" })];
    expect(matchCategory(cp, row("bill", -1, "Dialog Axiata"))).not.toBeNull();
    expect(matchCategory(cp, row("dialog bill"))).toBeNull();
    expect(matchCategory([rule({ operator: "regex", pattern: "(" })], row("("))).toBeNull();
  });

  it("isValidPattern", () => {
    expect(isValidPattern("regex", "(")).toBe(false);
    expect(isValidPattern("regex", "a".repeat(201))).toBe(false);
    expect(isValidPattern("contains", " ")).toBe(false);
    expect(isValidPattern("regex", "^a+$")).toBe(true);
  });
});
