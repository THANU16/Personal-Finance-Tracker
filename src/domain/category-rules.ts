// Category rules for CSV import (docs/03 categoryRules). Pure.

export const RULE_FIELDS = ["description", "counterparty"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_OPERATORS = ["contains", "equals", "regex"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export const MAX_REGEX_LENGTH = 200;

export interface RuleLike {
  id?: string;
  matchField: RuleField;
  operator: RuleOperator;
  pattern: string;
  categoryId: string;
  /** Kind of the rule's category: only rows going the same way match. */
  categoryKind: "income" | "expense";
  /** Lower runs first. */
  priority: number;
}

/** A regex rule's pattern compiles (case-insensitive) and is not too long. */
export function isValidPattern(operator: RuleOperator, pattern: string): boolean {
  if (!pattern.trim()) return false;
  if (operator !== "regex") return true;
  if (pattern.length > MAX_REGEX_LENGTH) return false;
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

function matches(rule: RuleLike, text: string | null): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  const p = rule.pattern.toLowerCase().trim();
  if (rule.operator === "contains") return p !== "" && t.includes(p);
  if (rule.operator === "equals") return t === p;
  if (!isValidPattern("regex", rule.pattern)) return false;
  return new RegExp(rule.pattern, "i").test(text);
}

/**
 * First matching rule by priority (then list order) whose category kind fits the row: money in →
 * income categories, money out → expense categories. null when nothing matches.
 */
export function matchCategory(
  rules: readonly RuleLike[],
  row: { description: string; counterparty: string | null; amountMinor: number },
): RuleLike | null {
  const kind = row.amountMinor > 0 ? "income" : "expense";
  const ordered = rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.priority - b.r.priority || a.i - b.i);
  for (const { r } of ordered) {
    if (r.categoryKind !== kind) continue;
    if (matches(r, r.matchField === "description" ? row.description : row.counterparty)) return r;
  }
  return null;
}
