import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  drawdownBp,
  replayCycle,
  ruleLevel,
  suggestedDeployment,
  validateRules,
  type MarketLevelPoint,
} from "@/domain/opportunity";

const lv = (date: string, level: number): MarketLevelPoint => ({ date, level });

describe("drawdownBp", () => {
  it("is the rounded drop from the reference high, never negative", () => {
    expect(drawdownBp(10_000, 8_800)).toBe(1200);
    expect(drawdownBp(10_000, 7_900)).toBe(2100);
    expect(drawdownBp(12_345.67, 11_000)).toBe(1090);
    expect(drawdownBp(10_000, 10_500)).toBe(0);
    expect(drawdownBp(0, 100)).toBe(0);
  });
});

describe("validateRules", () => {
  it("accepts the defaults and flags bad ladders", () => {
    expect(validateRules(DEFAULT_RULES)).toEqual([]);
    expect(
      validateRules([
        { drawdownBp: 2000, deployPercentBp: 5000 },
        { drawdownBp: 1000, deployPercentBp: 2500 },
      ]),
    ).toEqual([
      { index: 1, code: "drawdown_not_ascending" },
      { index: 1, code: "deploy_decreasing" },
    ]);
    expect(validateRules([{ drawdownBp: 0, deployPercentBp: 10_001 }])).toEqual([
      { index: 0, code: "out_of_range" },
    ]);
  });
});

describe("replayCycle", () => {
  it("opens a cycle at the first level and triggers rules as the drawdown deepens", () => {
    const s = replayCycle([lv("2026-01-01", 10_000), lv("2026-02-01", 8_800)], DEFAULT_RULES);
    expect(s).toMatchObject({
      cycleStart: "2026-01-01",
      referenceHigh: 10_000,
      drawdownBp: 1200,
      triggered: [0],
    });
    const deeper = replayCycle(
      [lv("2026-01-01", 10_000), lv("2026-02-01", 8_800), lv("2026-03-01", 7_900)],
      DEFAULT_RULES,
    );
    expect(deeper.triggered).toEqual([0, 1]);
  });

  it("keeps triggered rules after a partial recovery, until a new high resets the cycle", () => {
    const levels = [lv("2026-01-01", 10_000), lv("2026-02-01", 7_900), lv("2026-03-01", 9_500)];
    const s = replayCycle(levels, DEFAULT_RULES);
    expect(s.drawdownBp).toBe(500);
    expect(s.triggered).toEqual([0, 1]);
    expect(s.maxDrawdownBp).toBe(2100);

    const reset = replayCycle([...levels, lv("2026-04-01", 10_200)], DEFAULT_RULES);
    expect(reset).toMatchObject({
      cycleStart: "2026-04-01",
      referenceHigh: 10_200,
      referenceHighDate: "2026-04-01",
      drawdownBp: 0,
      triggered: [],
      maxDrawdownBp: 0,
    });
  });

  it("orders backdated levels by date and handles no levels", () => {
    const s = replayCycle([lv("2026-03-01", 8_800), lv("2026-01-01", 10_000)], DEFAULT_RULES);
    expect(s.latest).toEqual(lv("2026-03-01", 8_800));
    expect(s.triggered).toEqual([0]);
    expect(replayCycle([], DEFAULT_RULES)).toMatchObject({
      cycleStart: null,
      latest: null,
      triggered: [],
    });
  });
});

describe("suggestedDeployment (docs/04 §15 worked example)", () => {
  const base = { rules: DEFAULT_RULES, fundBalanceAtStartMinor: 100_000_000 };

  it("fund 1,000,000: −12% suggests 250,000; −21% with 250,000 deployed suggests 250,000 more", () => {
    expect(
      suggestedDeployment({
        ...base,
        triggered: [0],
        deployedThisCycleMinor: 0,
        fundBalanceMinor: 100_000_000,
      }),
    ).toEqual({ amountMinor: 25_000_000, ruleIdx: 0 });
    expect(
      suggestedDeployment({
        ...base,
        triggered: [0, 1],
        deployedThisCycleMinor: 25_000_000,
        fundBalanceMinor: 75_000_000,
      }),
    ).toEqual({ amountMinor: 25_000_000, ruleIdx: 1 });
  });

  it("earmark example: 200,000 with −10% → 25% suggests 50,000", () => {
    expect(
      suggestedDeployment({
        rules: [{ drawdownBp: 1000, deployPercentBp: 2500 }],
        triggered: [0],
        fundBalanceAtStartMinor: 20_000_000,
        deployedThisCycleMinor: 0,
        fundBalanceMinor: 20_000_000,
      }).amountMinor,
    ).toBe(5_000_000);
  });

  it("floors at 0 and caps at the current fund balance", () => {
    expect(
      suggestedDeployment({
        ...base,
        triggered: [0],
        deployedThisCycleMinor: 30_000_000,
        fundBalanceMinor: 70_000_000,
      }).amountMinor,
    ).toBe(0);
    expect(
      suggestedDeployment({
        ...base,
        triggered: [0, 1, 2],
        deployedThisCycleMinor: 0,
        fundBalanceMinor: 40_000_000,
      }).amountMinor,
    ).toBe(40_000_000);
    expect(
      suggestedDeployment({
        ...base,
        triggered: [],
        deployedThisCycleMinor: 0,
        fundBalanceMinor: 1,
      }),
    ).toEqual({ amountMinor: 0, ruleIdx: null });
  });
});

it("ruleLevel gives the index level that triggers a rule", () => {
  expect(ruleLevel(10_000, { drawdownBp: 2000, deployPercentBp: 5000 })).toBe(8_000);
});
