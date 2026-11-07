// docs/04 §6 — two-level allocation trees (target, SIP custom, opportunity custom). Pure.
import { allocateLargestRemainder, BP_SCALE } from "@/domain/money";

export interface AllocationAsset {
  holdingId: string;
  percentBp: number;
}

export interface AllocationClass {
  assetClassId: string;
  percentBp: number;
  /** Optional for the target (a class may be left without holdings); SIP custom trees list them. */
  assets: AllocationAsset[];
}

export type AllocationTree = AllocationClass[];

export interface TreeHoldingInfo {
  id: string;
  assetClassId: string;
  active: boolean;
}

export interface TreeIssue {
  /** "classes" | "class:<id>" | "asset:<holdingId>" */
  path: string;
  message: string;
}

export interface TreeValidation {
  errors: TreeIssue[];
  warnings: TreeIssue[];
}

const isBp = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= BP_SCALE;

/**
 * Class percents sum to exactly 100%; each class with assets: asset percents sum to 100%; no
 * duplicate classes or holdings; holdings active and in their class; integer bp. 0% classes warn.
 */
export function validateTree(
  tree: AllocationTree,
  holdings: readonly TreeHoldingInfo[],
  opts: {
    requireAssets?: boolean;
    /** What the classes must add up to: 100% minus an opportunity-fund share (§6). */
    totalBp?: number;
  } = {},
): TreeValidation {
  const totalBp = opts.totalBp ?? BP_SCALE;
  const errors: TreeIssue[] = [];
  const warnings: TreeIssue[] = [];
  if (tree.length === 0) errors.push({ path: "classes", message: "Add at least one asset class" });
  const byId = new Map(holdings.map((h) => [h.id, h]));
  const seenClasses = new Set<string>();
  const seenHoldings = new Set<string>();
  let classSum = 0;
  for (const c of tree) {
    const path = `class:${c.assetClassId}`;
    if (seenClasses.has(c.assetClassId)) errors.push({ path, message: "This class appears twice" });
    seenClasses.add(c.assetClassId);
    if (!isBp(c.percentBp)) errors.push({ path, message: "Use a percentage between 0 and 100" });
    else classSum += c.percentBp;
    if (c.percentBp === 0) warnings.push({ path, message: "This class is at 0%" });
    if (c.assets.length === 0) {
      if (opts.requireAssets)
        errors.push({ path, message: "Add at least one holding to this class" });
      continue;
    }
    let assetSum = 0;
    for (const a of c.assets) {
      const apath = `asset:${a.holdingId}`;
      if (seenHoldings.has(a.holdingId))
        errors.push({ path: apath, message: "This holding appears twice" });
      seenHoldings.add(a.holdingId);
      const h = byId.get(a.holdingId);
      if (!h) errors.push({ path: apath, message: "Holding not found" });
      else {
        if (!h.active) errors.push({ path: apath, message: "This holding is closed" });
        if (h.assetClassId !== c.assetClassId) {
          errors.push({ path: apath, message: "This holding belongs to another class" });
        }
      }
      if (!isBp(a.percentBp))
        errors.push({ path: apath, message: "Use a percentage between 0 and 100" });
      else assetSum += a.percentBp;
    }
    if (assetSum !== BP_SCALE) {
      errors.push({ path, message: "Holdings in this class must add up to 100%" });
    }
  }
  if (tree.length > 0 && classSum !== totalBp) {
    errors.push({
      path: "classes",
      message:
        totalBp === BP_SCALE
          ? "Classes must add up to 100%"
          : "Classes and the opportunity fund must add up to 100%",
    });
  }
  return { errors, warnings };
}

export interface SplitLine {
  assetClassId: string;
  /** null when the class has no holdings in the tree (picked at execution). */
  holdingId: string | null;
  amountMinor: number;
}

/**
 * Splits `total` across classes by largest remainder, then each class amount across its assets the
 * same way. Lines always sum exactly to `total` (docs/04 §6).
 */
export function splitByTree(total: number, tree: AllocationTree): SplitLine[] {
  if (tree.length === 0) throw new RangeError("tree is empty");
  const classAmounts = allocateLargestRemainder(
    total,
    tree.map((c) => c.percentBp),
  );
  const lines: SplitLine[] = [];
  tree.forEach((c, i) => {
    const amount = classAmounts[i]!;
    if (c.assets.length === 0) {
      lines.push({ assetClassId: c.assetClassId, holdingId: null, amountMinor: amount });
      return;
    }
    const assetAmounts = allocateLargestRemainder(
      amount,
      c.assets.map((a) => a.percentBp),
    );
    c.assets.forEach((a, j) =>
      lines.push({
        assetClassId: c.assetClassId,
        holdingId: a.holdingId,
        amountMinor: assetAmounts[j]!,
      }),
    );
  });
  return lines;
}

/**
 * docs/04 §6 — a tree whose classes add up to 100% minus `opportunityBp` (the opportunity-fund
 * share): `total` is split over the classes and the opportunity share together by largest
 * remainder, so lines + opportunity = total exactly (60/20/10/10 of 100,000 → 60,000 · 20,000 ·
 * 10,000 · 10,000). With no opportunity share it is splitByTree.
 */
export function splitWithOpportunity(
  total: number,
  tree: AllocationTree,
  opportunityBp: number,
): { lines: SplitLine[]; opportunityMinor: number } {
  if (opportunityBp <= 0)
    return { lines: tree.length ? splitByTree(total, tree) : [], opportunityMinor: 0 };
  const amounts = allocateLargestRemainder(total, [...tree.map((c) => c.percentBp), opportunityBp]);
  const lines = tree.flatMap((c, i) => splitByTree(amounts[i]!, [{ ...c, percentBp: BP_SCALE }]));
  return { lines, opportunityMinor: amounts.at(-1)! };
}

/**
 * The investment classes rescaled to 100% (largest remainder) — drift, rebalancing and
 * opportunity deployments compare investments only, never the opportunity-fund share.
 */
export function normalizeTree(tree: AllocationTree): AllocationTree {
  const sum = tree.reduce((s, c) => s + c.percentBp, 0);
  if (sum === BP_SCALE || sum === 0) return tree;
  const scaled = allocateLargestRemainder(
    BP_SCALE,
    tree.map((c) => c.percentBp),
  );
  return tree.map((c, i) => ({ ...c, percentBp: scaled[i]! }));
}

/** Distributes what is missing to 100% onto the last row (the editor's "Auto-balance"). */
export function autoBalance<T extends { percentBp: number }>(rows: readonly T[]): T[] {
  if (rows.length === 0) return [];
  const others = rows.slice(0, -1).reduce((s, r) => s + r.percentBp, 0);
  const last = rows.at(-1)!;
  return [...rows.slice(0, -1), { ...last, percentBp: Math.max(0, BP_SCALE - others) }];
}

/** Holdings referenced by a tree. */
export function treeHoldingIds(tree: AllocationTree): string[] {
  return tree.flatMap((c) => c.assets.map((a) => a.holdingId));
}
