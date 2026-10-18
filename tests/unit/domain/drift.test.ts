import { describe, expect, it } from "vitest";
import type { AllocationTree } from "@/domain/allocation";
import {
  cashflowPlan,
  computeDrift,
  fullRebalance,
  statusOf,
  type DriftHolding,
} from "@/domain/drift";

const TREE: AllocationTree = [
  {
    assetClassId: "equity",
    percentBp: 6_000,
    assets: [
      { holdingId: "A", percentBp: 5_000 },
      { holdingId: "B", percentBp: 5_000 },
    ],
  },
  { assetClassId: "fixed", percentBp: 3_000, assets: [{ holdingId: "UT", percentBp: 10_000 }] },
  { assetClassId: "gold", percentBp: 1_000, assets: [] },
];

const h = (
  id: string,
  assetClassId: string,
  valueMinor: number,
  extra: Partial<DriftHolding> = {},
): DriftHolding => ({
  id,
  assetClassId,
  valueMinor,
  active: true,
  countsTowardEmergencyFund: false,
  ...extra,
});

// V = 100,000: equity 70,000 (A 50,000 / B 20,000), fixed 20,000, gold 10,000
const HOLDINGS = [
  h("A", "equity", 50_000),
  h("B", "equity", 20_000),
  h("UT", "fixed", 20_000),
  h("G1", "gold", 10_000),
];

describe("computeDrift (docs/04 §8)", () => {
  const d = computeDrift(TREE, HOLDINGS, 500);

  it("weights and drift in bp; flagged at |drift| ≥ threshold", () => {
    expect(d.universeValueMinor).toBe(100_000);
    expect(
      d.classes.map((c) => [c.assetClassId, c.weightBp, c.targetBp, c.driftBp, c.status]),
    ).toEqual([
      ["equity", 7_000, 6_000, 1_000, "over"],
      ["fixed", 2_000, 3_000, -1_000, "under"],
      ["gold", 1_000, 1_000, 0, "ok"],
    ]);
    expect(d.flaggedCount).toBe(2);
  });

  it("asset drift within the class against its holding targets", () => {
    const eq = d.classes[0]!;
    expect(
      eq.assets.map((a) => [a.holdingId, a.weightInClassBp, a.targetInClassBp, a.driftBp]),
    ).toEqual([
      ["A", 7_143, 5_000, 2_143],
      ["B", 2_857, 5_000, -2_143],
    ]);
    const gold = d.classes[2]!;
    expect(gold.assets).toEqual([
      {
        holdingId: "G1",
        valueMinor: 10_000,
        weightInClassBp: 10_000,
        targetInClassBp: null,
        driftBp: null,
        inTarget: false,
        locked: false,
      },
    ]);
  });

  it("by default emergency-fund holdings and outside classes do not move drift (docs/04 §8)", () => {
    const hidden = computeDrift(
      TREE,
      [
        ...HOLDINGS,
        h("EF", "fixed", 20_000, { countsTowardEmergencyFund: true }),
        h("BTC", "crypto", 40_000),
      ],
      500,
    );
    expect(hidden.classes.map((c) => c.driftBp)).toEqual(d.classes.map((c) => c.driftBp));
    expect(hidden.universeValueMinor).toBe(100_000);
    expect(hidden.excludedEmergencyMinor).toBe(20_000);
    expect(hidden.lockedEmergencyMinor).toBe(0);
    expect(
      fullRebalance(TREE, [
        ...HOLDINGS,
        h("EF", "fixed", 20_000, { countsTowardEmergencyFund: true }),
      ]).some((t) => t.holdingId === "EF"),
    ).toBe(false);
  });

  it("included (toggle): emergency-fund holdings count in the weights (locked); outside classes and closed ones do not", () => {
    const more = [
      ...HOLDINGS,
      h("EF", "fixed", 20_000, { countsTowardEmergencyFund: true }),
      h("BTC", "crypto", 40_000),
      h("CLOSED", "equity", 99_999, { active: false }),
    ];
    const d2 = computeDrift(TREE, more, 500, { includeEmergency: true });
    expect(d2.universeValueMinor).toBe(120_000);
    // fixed = UT 20,000 + EF 20,000 = 40,000 of 120,000
    expect(d2.classes.map((c) => [c.assetClassId, c.weightBp])).toEqual([
      ["equity", 5_833],
      ["fixed", 3_333],
      ["gold", 833],
    ]);
    expect(d2.classes[1]!.assets.find((a) => a.holdingId === "EF")).toMatchObject({
      locked: true,
      inTarget: false,
      weightInClassBp: 5_000,
    });
    expect(d2.lockedEmergencyMinor).toBe(20_000);
    expect(d2.outside).toEqual([{ assetClassId: "crypto", valueMinor: 40_000 }]);
  });

  it("a holding missing from its class list counts with a 0% target", () => {
    const d3 = computeDrift(TREE, [...HOLDINGS, h("C", "equity", 10_000)], 500);
    const c = d3.classes[0]!.assets.find((a) => a.holdingId === "C")!;
    expect(c).toMatchObject({ targetInClassBp: 0, inTarget: false });
    expect(c.driftBp).toBeGreaterThan(0);
  });

  it("threshold edge: exactly at the threshold is flagged", () => {
    expect(statusOf(500, 500)).toBe("over");
    expect(statusOf(-499, 500)).toBe("ok");
  });

  it("empty universe: every class is under target", () => {
    const empty = computeDrift(TREE, [], 500);
    expect(empty.universeValueMinor).toBe(0);
    expect(empty.classes.map((c) => c.status)).toEqual(["under", "under", "under"]);
  });
});

describe("fullRebalance", () => {
  it("trade = target × V − value; trades sum to exactly zero", () => {
    const trades = fullRebalance(TREE, HOLDINGS);
    expect(trades.map((t) => [t.holdingId, t.targetMinor, t.tradeMinor])).toEqual([
      ["A", 30_000, -20_000],
      ["B", 30_000, 10_000],
      ["UT", 30_000, 10_000],
      [null, 10_000, 0],
    ]);
    expect(trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
  });

  it("sums to zero for awkward amounts (largest remainder)", () => {
    for (const v of [1, 7, 33_333, 100_001, 9_999_999]) {
      const trades = fullRebalance(TREE, [
        h("A", "equity", v),
        h("UT", "fixed", 3),
        h("G1", "gold", 1),
      ]);
      expect(trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
    }
  });

  it("unlisted holdings get a 0 target (sell all); FDs are marked", () => {
    const trades = fullRebalance(TREE, [
      ...HOLDINGS,
      h("C", "equity", 10_000),
      h("FD", "fixed", 5_000, { isFd: true }),
    ]);
    expect(trades.find((t) => t.holdingId === "C")).toMatchObject({
      targetMinor: 0,
      tradeMinor: -10_000,
    });
    expect(trades.find((t) => t.holdingId === "FD")).toMatchObject({ isFd: true, targetMinor: 0 });
    expect(trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
  });
});

describe("fullRebalance with a locked emergency-fund holding", () => {
  it("keeps it (trade 0); it counts toward its own class target; trades still sum to 0", () => {
    // V = 120,000: ideal equity 72,000, fixed 36,000 (EF 20,000 locked → UT 16,000), gold 12,000
    const trades = fullRebalance(
      TREE,
      [...HOLDINGS, h("EF", "fixed", 20_000, { countsTowardEmergencyFund: true })],
      { includeEmergency: true },
    );
    expect(trades.map((t) => [t.holdingId, t.locked, t.targetMinor, t.tradeMinor])).toEqual([
      ["A", false, 36_000, -14_000],
      ["B", false, 36_000, 16_000],
      ["UT", false, 16_000, -4_000],
      ["EF", true, 20_000, 0],
      [null, false, 12_000, 2_000],
    ]);
    expect(trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
  });

  it("a locked holding above its class target pushes the other classes, never itself", () => {
    const trades = fullRebalance(
      TREE,
      [...HOLDINGS, h("EF", "fixed", 80_000, { countsTowardEmergencyFund: true })],
      { includeEmergency: true },
    );
    expect(trades.find((t) => t.holdingId === "EF")).toMatchObject({ locked: true, tradeMinor: 0 });
    expect(trades.find((t) => t.holdingId === "UT")!.targetMinor).toBe(0);
    expect(trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
    for (const v of [1, 7, 33_333, 9_999_999]) {
      const t2 = fullRebalance(
        TREE,
        [
          h("A", "equity", v),
          h("EF", "gold", 5, { countsTowardEmergencyFund: true }),
          h("UT", "fixed", 3),
        ],
        { includeEmergency: true },
      );
      expect(t2.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
      expect(t2.find((t) => t.holdingId === "EF")!.tradeMinor).toBe(0);
    }
  });
});

describe("cashflowPlan (invest new money)", () => {
  it("never buys a locked emergency-fund holding", () => {
    const tree: AllocationTree = [
      { assetClassId: "equity", percentBp: 6_000, assets: [{ holdingId: "A", percentBp: 10_000 }] },
      {
        assetClassId: "fixed",
        percentBp: 4_000,
        assets: [
          { holdingId: "EF", percentBp: 5_000 },
          { holdingId: "UT", percentBp: 5_000 },
        ],
      },
    ];
    const plan = cashflowPlan(
      50_000,
      tree,
      [
        h("A", "equity", 60_000),
        h("EF", "fixed", 10_000, { countsTowardEmergencyFund: true }),
        h("UT", "fixed", 0),
      ],
      { includeEmergency: true },
    );
    expect(plan.some((l) => l.holdingId === "EF")).toBe(false);
    expect(plan.reduce((s, l) => s + l.amountMinor, 0)).toBe(50_000);
    expect(plan.find((l) => l.holdingId === "UT")!.amountMinor).toBeGreaterThan(0);
  });

  it("only buys, sums to the amount, and favours the underweight class", () => {
    const plan = cashflowPlan(10_000, TREE, HOLDINGS);
    expect(plan.every((l) => l.amountMinor > 0)).toBe(true);
    expect(plan.reduce((s, l) => s + l.amountMinor, 0)).toBe(10_000);
    // targets on 110,000: equity 66,000 (none), fixed 33,000 (deficit 13,000), gold 11,000 (1,000)
    expect(plan.map((l) => [l.holdingId, l.amountMinor])).toEqual([
      ["UT", 9_286],
      [null, 714],
    ]);
  });

  it("nothing for zero or no target", () => {
    expect(cashflowPlan(0, TREE, HOLDINGS)).toEqual([]);
    expect(cashflowPlan(1_000, [], HOLDINGS)).toEqual([]);
  });
});

describe("fullRebalance on a large portfolio", () => {
  it("does not overflow and still sums to zero (LKR 27M with a locked holding)", () => {
    const big = [
      h("A", "equity", 1_500_000_000),
      h("B", "equity", 700_000_000),
      h("UT", "fixed", 400_000_000),
      h("EF", "fixed", 300_000_000, { countsTowardEmergencyFund: true }),
      h("G1", "gold", 27_886_250),
    ];
    const trades = fullRebalance(TREE, big, { includeEmergency: true });
    expect(trades.reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
    expect(trades.find((t) => t.holdingId === "EF")!.tradeMinor).toBe(0);
    expect(() => computeDrift(TREE, big, 500, { includeEmergency: true })).not.toThrow();
    expect(fullRebalance(TREE, big).reduce((s, t) => s + t.tradeMinor, 0)).toBe(0);
    expect(
      cashflowPlan(5_000_000_000, TREE, big, { includeEmergency: true }).reduce(
        (s, l) => s + l.amountMinor,
        0,
      ),
    ).toBe(5_000_000_000);
  });
});
