// docs/04 §8 — rebalancing maths. Phase 5 needs the cashflow split (SIP drift tilt); Phase 6 adds
// drift and the full rebalance. Pure, integer minor units.
import { splitByTree, type AllocationTree, type SplitLine } from "@/domain/allocation";
import { allocateLargestRemainder, BP_SCALE, mulDivRound } from "@/domain/money";

/**
 * Cashflow rebalance for new money `S`: deficit_c = max(0, target_c × (V + S) − value_c);
 * S is allocated proportionally to the deficits (largest remainder); with no deficit the plain
 * target split is used. Within a class, amounts follow the tree's asset percents.
 * `classValues` = current value per asset class of the target universe (base currency).
 */
export function cashflowSplit(
  S: number,
  tree: AllocationTree,
  classValues: Readonly<Record<string, number>>,
): SplitLine[] {
  const V = tree.reduce((s, c) => s + Math.max(0, classValues[c.assetClassId] ?? 0), 0);
  const deficits = tree.map((c) =>
    Math.max(
      0,
      mulDivRound(c.percentBp, V + S, BP_SCALE) - Math.max(0, classValues[c.assetClassId] ?? 0),
    ),
  );
  if (deficits.every((d) => d === 0)) return splitByTree(S, tree);
  const classAmounts = allocateLargestRemainder(S, deficits);
  // Reuse the tree split for the in-class step: each class gets exactly its tilted amount.
  return tree.flatMap((c, i) =>
    splitByTree(classAmounts[i]!, [{ ...c, percentBp: BP_SCALE }]).map((l) => ({
      ...l,
      assetClassId: c.assetClassId,
    })),
  );
}
