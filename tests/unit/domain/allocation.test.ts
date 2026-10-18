import { describe, expect, it } from "vitest";
import {
  autoBalance,
  splitByTree,
  validateTree,
  type AllocationTree,
  type TreeHoldingInfo,
} from "@/domain/allocation";
import { cashflowSplit } from "@/domain/rebalance";

// docs/04 §6 worked example
const EXAMPLE: AllocationTree = [
  {
    assetClassId: "equity",
    percentBp: 5_000,
    assets: [
      { holdingId: "A", percentBp: 4_000 },
      { holdingId: "B", percentBp: 2_000 },
      { holdingId: "MF", percentBp: 4_000 },
    ],
  },
  { assetClassId: "fixed", percentBp: 3_000, assets: [{ holdingId: "UT", percentBp: 10_000 }] },
  { assetClassId: "gold", percentBp: 1_000, assets: [{ holdingId: "GOLD", percentBp: 10_000 }] },
  { assetClassId: "crypto", percentBp: 1_000, assets: [{ holdingId: "BTC", percentBp: 10_000 }] },
];

const HOLDINGS: TreeHoldingInfo[] = [
  { id: "A", assetClassId: "equity", active: true },
  { id: "B", assetClassId: "equity", active: true },
  { id: "MF", assetClassId: "equity", active: true },
  { id: "UT", assetClassId: "fixed", active: true },
  { id: "GOLD", assetClassId: "gold", active: true },
  { id: "BTC", assetClassId: "crypto", active: true },
];

describe("splitByTree", () => {
  it("docs/04 §6: 100,000.00 splits exactly", () => {
    const lines = splitByTree(100_000_00, EXAMPLE);
    expect(lines.map((l) => [l.holdingId, l.amountMinor])).toEqual([
      ["A", 20_000_00],
      ["B", 10_000_00],
      ["MF", 20_000_00],
      ["UT", 30_000_00],
      ["GOLD", 10_000_00],
      ["BTC", 10_000_00],
    ]);
  });

  it("lines always sum to the total (largest remainder at both levels, ties → earlier)", () => {
    for (const total of [1, 7, 99_999, 100_000_01, 333_333_33]) {
      const lines = splitByTree(total, EXAMPLE);
      expect(lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(total);
    }
    const thirds = splitByTree(100, [
      {
        assetClassId: "c",
        percentBp: 10_000,
        assets: [
          { holdingId: "x", percentBp: 3_334 },
          { holdingId: "y", percentBp: 3_333 },
          { holdingId: "z", percentBp: 3_333 },
        ],
      },
    ]);
    expect(thirds.map((l) => l.amountMinor)).toEqual([34, 33, 33]);
    const tie = splitByTree(1, [
      { assetClassId: "a", percentBp: 5_000, assets: [] },
      { assetClassId: "b", percentBp: 5_000, assets: [] },
    ]);
    expect(tie.map((l) => l.amountMinor)).toEqual([1, 0]);
  });

  it("a class without holdings gives one line with holdingId null", () => {
    expect(splitByTree(1_000, [{ assetClassId: "c", percentBp: 10_000, assets: [] }])).toEqual([
      { assetClassId: "c", holdingId: null, amountMinor: 1_000 },
    ]);
  });
});

describe("validateTree", () => {
  it("accepts the example", () => {
    expect(validateTree(EXAMPLE, HOLDINGS)).toEqual({ errors: [], warnings: [] });
  });

  it("classes must sum to 100%; assets within a class too", () => {
    const bad: AllocationTree = [
      { ...EXAMPLE[0]!, percentBp: 4_000, assets: [{ holdingId: "A", percentBp: 9_000 }] },
      EXAMPLE[1]!,
    ];
    const r = validateTree(bad, HOLDINGS);
    expect(r.errors.map((e) => e.path)).toEqual(["class:equity", "classes"]);
  });

  it("duplicates, wrong class, closed holdings and bad percents are errors; 0% warns", () => {
    const r = validateTree(
      [
        {
          assetClassId: "equity",
          percentBp: 10_000,
          assets: [
            { holdingId: "A", percentBp: 5_000 },
            { holdingId: "A", percentBp: 2_500 },
            { holdingId: "UT", percentBp: 2_500 },
          ],
        },
        { assetClassId: "equity", percentBp: 0, assets: [] },
        { assetClassId: "gold", percentBp: 0, assets: [{ holdingId: "GONE", percentBp: 10_000 }] },
      ],
      [...HOLDINGS, { id: "GONE", assetClassId: "gold", active: false }],
    );
    expect(r.errors.map((e) => e.message)).toEqual([
      "This holding appears twice",
      "This holding belongs to another class",
      "This class appears twice",
      "This holding is closed",
    ]);
    expect(r.warnings.map((w) => w.path)).toEqual(["class:equity", "class:gold"]);
    expect(
      validateTree([{ assetClassId: "x", percentBp: 10_001, assets: [] }], []).errors.length,
    ).toBe(2);
  });

  it("classes without holdings are allowed for the target, not when assets are required", () => {
    const tree: AllocationTree = [{ assetClassId: "gold", percentBp: 10_000, assets: [] }];
    expect(validateTree(tree, HOLDINGS).errors).toEqual([]);
    expect(validateTree(tree, HOLDINGS, { requireAssets: true }).errors.length).toBe(1);
  });
});

describe("autoBalance", () => {
  it("gives the remainder to the last row", () => {
    expect(autoBalance([{ percentBp: 6_000 }, { percentBp: 1_000 }])).toEqual([
      { percentBp: 6_000 },
      { percentBp: 4_000 },
    ]);
  });
});

describe("cashflowSplit (docs/04 §8, SIP drift tilt)", () => {
  const tree: AllocationTree = [
    {
      assetClassId: "equity",
      percentBp: 6_000,
      assets: [
        { holdingId: "A", percentBp: 5_000 },
        { holdingId: "B", percentBp: 5_000 },
      ],
    },
    { assetClassId: "fixed", percentBp: 4_000, assets: [{ holdingId: "UT", percentBp: 10_000 }] },
  ];

  it("new money goes to the underweight class", () => {
    // V = 100,000: equity 70,000 (over), fixed 30,000 (under). S = 10,000.
    // targets on 110,000: equity 66,000 (deficit 0), fixed 44,000 (deficit 14,000) → all S to fixed.
    const lines = cashflowSplit(10_000, tree, { equity: 70_000, fixed: 30_000 });
    expect(lines.map((l) => [l.holdingId, l.amountMinor])).toEqual([
      ["A", 0],
      ["B", 0],
      ["UT", 10_000],
    ]);
  });

  it("splits by deficits and keeps the total exact", () => {
    // V = 100,000 equity 50,000 fixed 50,000; S = 20,000 → targets 72,000 / 48,000 → deficits 22,000 / 0
    const lines = cashflowSplit(20_001, tree, { equity: 50_000, fixed: 50_000 });
    expect(lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(20_001);
    expect(lines.find((l) => l.holdingId === "UT")!.amountMinor).toBe(0);
  });

  it("falls back to the target split when nothing is underweight", () => {
    expect(cashflowSplit(1_000, tree, {})).toEqual(splitByTree(1_000, tree));
  });
});
