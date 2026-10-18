// Opportunity Fund (docs/04 §15). Pure: no DB, no Next.js. Levels are plain numbers (index points),
// money is integer minor units, percentages are basis points.

export interface OpportunityRule {
  /** Drawdown from the reference high that triggers the rule (bp, e.g. 1000 = −10%). */
  drawdownBp: number;
  /** Cumulative share of the fund balance at cycle start to have deployed (bp). */
  deployPercentBp: number;
}

export interface MarketLevelPoint {
  /** Business date `YYYY-MM-DD`. */
  date: string;
  level: number;
}

export const DEFAULT_RULES: readonly OpportunityRule[] = [
  { drawdownBp: 1000, deployPercentBp: 2500 },
  { drawdownBp: 2000, deployPercentBp: 5000 },
  { drawdownBp: 3000, deployPercentBp: 10000 },
];

/** `round((high − level) / high × 10000)`, never negative (a level above the high is 0). */
export function drawdownBp(referenceHigh: number, level: number): number {
  if (!(referenceHigh > 0) || !Number.isFinite(level)) return 0;
  return Math.max(0, Math.round(((referenceHigh - level) / referenceHigh) * 10_000));
}

export type RuleIssue =
  | { index: number; code: "out_of_range" }
  | { index: number; code: "drawdown_not_ascending" }
  | { index: number; code: "deploy_decreasing" };

/** Rules are cumulative targets: drawdowns strictly ascending, deploy % never decreasing, 1–10000. */
export function validateRules(rules: readonly OpportunityRule[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  rules.forEach((r, i) => {
    const ok = (v: number) => Number.isInteger(v) && v >= 1 && v <= 10_000;
    if (!ok(r.drawdownBp) || !ok(r.deployPercentBp))
      issues.push({ index: i, code: "out_of_range" });
    const prev = rules[i - 1];
    if (prev && r.drawdownBp <= prev.drawdownBp) {
      issues.push({ index: i, code: "drawdown_not_ascending" });
    }
    if (prev && r.deployPercentBp < prev.deployPercentBp) {
      issues.push({ index: i, code: "deploy_decreasing" });
    }
  });
  return issues;
}

export interface CycleState {
  /** Date of the level that set the current reference high (null before the first level). */
  cycleStart: string | null;
  referenceHigh: number | null;
  referenceHighDate: string | null;
  latest: MarketLevelPoint | null;
  /** Drawdown of the latest level from the reference high. */
  drawdownBp: number;
  /** Indexes of rules reached at any level since the cycle started (each fires once per cycle). */
  triggered: number[];
  /** Deepest drawdown seen this cycle. */
  maxDrawdownBp: number;
}

/**
 * Replays levels in date order (docs/04 §15): the first level opens a cycle; a level above the
 * reference high starts a new cycle (high = level, triggered list cleared). Rules trigger when the
 * drawdown reaches them; once triggered they stay triggered until the next new high.
 */
export function replayCycle(
  levels: readonly MarketLevelPoint[],
  rules: readonly OpportunityRule[],
): CycleState {
  const sorted = [...levels].sort((a, b) => a.date.localeCompare(b.date));
  const state: CycleState = {
    cycleStart: null,
    referenceHigh: null,
    referenceHighDate: null,
    latest: null,
    drawdownBp: 0,
    triggered: [],
    maxDrawdownBp: 0,
  };
  const triggered = new Set<number>();
  for (const p of sorted) {
    if (state.referenceHigh === null || p.level > state.referenceHigh) {
      state.referenceHigh = p.level;
      state.referenceHighDate = p.date;
      state.cycleStart = p.date;
      state.maxDrawdownBp = 0;
      triggered.clear();
    }
    const dd = drawdownBp(state.referenceHigh, p.level);
    state.maxDrawdownBp = Math.max(state.maxDrawdownBp, dd);
    rules.forEach((r, i) => {
      if (dd >= r.drawdownBp) triggered.add(i);
    });
    state.latest = p;
    state.drawdownBp = dd;
  }
  state.triggered = [...triggered].sort((a, b) => a - b);
  return state;
}

/**
 * Suggested deployment = deployPercent of the highest triggered rule × fund balance at cycle start −
 * deployed this cycle, floored at 0 and capped at the current fund balance.
 */
export function suggestedDeployment(input: {
  rules: readonly OpportunityRule[];
  triggered: readonly number[];
  fundBalanceAtStartMinor: number;
  deployedThisCycleMinor: number;
  fundBalanceMinor: number;
}): { amountMinor: number; ruleIdx: number | null } {
  if (!input.triggered.length) return { amountMinor: 0, ruleIdx: null };
  const ruleIdx = Math.max(...input.triggered);
  const rule = input.rules[ruleIdx];
  if (!rule) return { amountMinor: 0, ruleIdx: null };
  const target = Math.round((input.fundBalanceAtStartMinor * rule.deployPercentBp) / 10_000);
  const remaining = Math.max(0, target - input.deployedThisCycleMinor);
  return { amountMinor: Math.min(remaining, Math.max(0, input.fundBalanceMinor)), ruleIdx };
}

/** Level at which a rule triggers for a reference high (for chart rule lines). */
export function ruleLevel(referenceHigh: number, rule: OpportunityRule): number {
  return referenceHigh * (1 - rule.drawdownBp / 10_000);
}
