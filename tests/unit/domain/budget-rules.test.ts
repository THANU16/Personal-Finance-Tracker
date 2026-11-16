import { describe, expect, it } from "vitest";
import { effectiveBudgets, ruleCovers, type BudgetRule, type MonthBudget } from "@/domain/budgets";

// Repeating budgets (owner request, docs/04 §13).
const rule = (
  categoryId: string,
  amountMinor: number,
  fromMonth: string,
  untilMonth: string | null = null,
): BudgetRule => ({ categoryId, amountMinor, fromMonth, untilMonth });
const row = (categoryId: string, amountMinor: number, skip = false): MonthBudget => ({
  categoryId,
  amountMinor,
  skip,
});
const amounts = (m: string, rows: MonthBudget[], rules: BudgetRule[]) =>
  Object.fromEntries(effectiveBudgets(m, rows, rules).map((b) => [b.categoryId, b.amountMinor]));

describe("ruleCovers", () => {
  it("from month inclusive, until month inclusive, null = no end", () => {
    expect(ruleCovers(rule("a", 1, "2026-03"), "2026-02")).toBe(false);
    expect(ruleCovers(rule("a", 1, "2026-03"), "2026-03")).toBe(true);
    expect(ruleCovers(rule("a", 1, "2026-03"), "2030-12")).toBe(true);
    expect(ruleCovers(rule("a", 1, "2026-03", "2026-06"), "2026-06")).toBe(true);
    expect(ruleCovers(rule("a", 1, "2026-03", "2026-06"), "2026-07")).toBe(false);
  });
});

describe("effectiveBudgets", () => {
  it("a repeating budget applies every month from its start, not before", () => {
    const rules = [rule("food", 50_000, "2026-03")];
    expect(amounts("2026-02", [], rules)).toEqual({});
    expect(amounts("2026-03", [], rules)).toEqual({ food: 50_000 });
    expect(amounts("2027-11", [], rules)).toEqual({ food: 50_000 });
    expect(effectiveBudgets("2026-05", [], rules)[0]!.repeat).toEqual({
      fromMonth: "2026-03",
      untilMonth: null,
    });
  });

  it("a change from a later month: the latest start wins, earlier months keep the old amount", () => {
    const rules = [rule("food", 50_000, "2026-01"), rule("food", 60_000, "2026-06")];
    expect(amounts("2026-05", [], rules)).toEqual({ food: 50_000 });
    expect(amounts("2026-06", [], rules)).toEqual({ food: 60_000 });
    expect(amounts("2027-01", [], rules)).toEqual({ food: 60_000 });
  });

  it("a ranged budget ends; an older open-ended one applies again after it", () => {
    const rules = [rule("food", 50_000, "2026-01"), rule("food", 80_000, "2026-11", "2026-12")];
    expect(amounts("2026-12", [], rules)).toEqual({ food: 80_000 });
    expect(amounts("2027-01", [], rules)).toEqual({ food: 50_000 });
    expect(amounts("2027-01", [], [rule("x", 1, "2026-01", "2026-12")])).toEqual({});
  });

  it("a one-month row overrides the repeating budget; a skip row removes it for that month", () => {
    const rules = [rule("food", 50_000, "2026-01"), rule("fuel", 20_000, "2026-01")];
    const dec = effectiveBudgets("2026-12", [row("food", 90_000), row("fuel", 0, true)], rules);
    expect(dec).toEqual([{ categoryId: "food", amountMinor: 90_000, repeat: null }]);
    expect(amounts("2027-01", [], rules)).toEqual({ food: 50_000, fuel: 20_000 });
  });

  it("one-month budgets alone work as before", () => {
    expect(amounts("2026-04", [row("a", 1_000), row("b", 2_000)], [])).toEqual({
      a: 1_000,
      b: 2_000,
    });
  });
});
