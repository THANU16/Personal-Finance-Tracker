// docs/04 §8 — drift and full rebalance against the target allocation. Pure, integer minor units / bp.
import type { AllocationTree } from "@/domain/allocation";
import { allocateLargestRemainder, BP_SCALE, mulDivRound } from "@/domain/money";
import { cashflowSplit } from "@/domain/rebalance";

export interface DriftHolding {
  id: string;
  assetClassId: string;
  /** Current value in base currency. */
  valueMinor: number;
  active: boolean;
  countsTowardEmergencyFund: boolean;
  isFd?: boolean;
}

export type DriftStatus = "ok" | "over" | "under";

export interface AssetDrift {
  holdingId: string;
  valueMinor: number;
  /** Share of its class value. */
  weightInClassBp: number;
  /** null when the class has no holding targets. */
  targetInClassBp: number | null;
  driftBp: number | null;
  /** Listed in the class's holding targets. */
  inTarget: boolean;
}

export interface ClassDrift {
  assetClassId: string;
  valueMinor: number;
  weightBp: number;
  targetBp: number;
  driftBp: number;
  status: DriftStatus;
  hasAssetTargets: boolean;
  assets: AssetDrift[];
}

export interface DriftResult {
  universeValueMinor: number;
  classes: ClassDrift[];
  /** Holdings in classes that are not in the target ("outside target"). */
  outside: { assetClassId: string; valueMinor: number }[];
  /** Emergency-flagged holdings left out of the universe. */
  excludedEmergencyMinor: number;
  flaggedCount: number;
}

const share = (part: number, whole: number) => (whole > 0 ? mulDivRound(part, BP_SCALE, whole) : 0);

/** The rebalancing universe: active, not emergency-flagged, class in the target. */
export function universeOf(tree: AllocationTree, holdings: readonly DriftHolding[]) {
  const inTarget = new Set(tree.map((c) => c.assetClassId));
  const active = holdings.filter((h) => h.active && h.valueMinor > 0);
  return {
    universe: active.filter((h) => !h.countsTowardEmergencyFund && inTarget.has(h.assetClassId)),
    outsideHoldings: active.filter(
      (h) => !h.countsTowardEmergencyFund && !inTarget.has(h.assetClassId),
    ),
    emergency: active.filter((h) => h.countsTowardEmergencyFund),
  };
}

export function statusOf(driftBp: number, thresholdBp: number): DriftStatus {
  if (Math.abs(driftBp) < thresholdBp) return "ok";
  return driftBp > 0 ? "over" : "under";
}

/**
 * V = Σ universe values; weight_i = value_i / V; drift_i = weight_i − target_i (bp). A class is
 * flagged when |drift| ≥ threshold. Asset drift is within the class against its holding targets;
 * holdings in the class but not listed count with a 0% target (owner decision, Phase 6).
 */
export function computeDrift(
  tree: AllocationTree,
  holdings: readonly DriftHolding[],
  thresholdBp: number,
): DriftResult {
  const { universe, outsideHoldings, emergency } = universeOf(tree, holdings);
  const V = universe.reduce((s, h) => s + h.valueMinor, 0);
  const classes: ClassDrift[] = tree.map((c) => {
    const members = universe.filter((h) => h.assetClassId === c.assetClassId);
    const value = members.reduce((s, h) => s + h.valueMinor, 0);
    const weightBp = share(value, V);
    const driftBp = weightBp - c.percentBp;
    const hasAssetTargets = c.assets.length > 0;
    const listed = new Map(c.assets.map((a) => [a.holdingId, a.percentBp]));
    const ids = [...new Set([...c.assets.map((a) => a.holdingId), ...members.map((m) => m.id)])];
    const assets: AssetDrift[] = ids.map((id) => {
      const v = members.find((m) => m.id === id)?.valueMinor ?? 0;
      const weightInClassBp = share(v, value);
      const target = hasAssetTargets ? (listed.get(id) ?? 0) : null;
      return {
        holdingId: id,
        valueMinor: v,
        weightInClassBp,
        targetInClassBp: target,
        driftBp: target === null ? null : weightInClassBp - target,
        inTarget: listed.has(id),
      };
    });
    return {
      assetClassId: c.assetClassId,
      valueMinor: value,
      weightBp,
      targetBp: c.percentBp,
      driftBp,
      status: statusOf(driftBp, thresholdBp),
      hasAssetTargets,
      assets,
    };
  });
  const outside = new Map<string, number>();
  for (const h of outsideHoldings)
    outside.set(h.assetClassId, (outside.get(h.assetClassId) ?? 0) + h.valueMinor);
  return {
    universeValueMinor: V,
    classes,
    outside: [...outside.entries()].map(([assetClassId, valueMinor]) => ({
      assetClassId,
      valueMinor,
    })),
    excludedEmergencyMinor: emergency.reduce((s, h) => s + h.valueMinor, 0),
    flaggedCount: classes.filter((c) => c.status !== "ok").length,
  };
}

export interface TradeLine {
  assetClassId: string;
  /** null = class-level line (class has no holding targets): pick the holding when applying. */
  holdingId: string | null;
  valueMinor: number;
  targetMinor: number;
  /** Positive = buy, negative = sell. */
  tradeMinor: number;
  isFd: boolean;
}

/**
 * Full rebalance: trade_i = target_i × V − value_i. Target amounts are split by largest
 * remainder so Σ targets = V exactly and therefore Σ trades = 0.
 */
export function fullRebalance(
  tree: AllocationTree,
  holdings: readonly DriftHolding[],
): TradeLine[] {
  const { universe } = universeOf(tree, holdings);
  const V = universe.reduce((s, h) => s + h.valueMinor, 0);
  const slots: {
    assetClassId: string;
    holdingId: string | null;
    weight: number;
    valueMinor: number;
    isFd: boolean;
  }[] = [];
  for (const c of tree) {
    const members = universe.filter((h) => h.assetClassId === c.assetClassId);
    if (c.assets.length === 0) {
      slots.push({
        assetClassId: c.assetClassId,
        holdingId: null,
        weight: c.percentBp * BP_SCALE,
        valueMinor: members.reduce((s, h) => s + h.valueMinor, 0),
        isFd: false,
      });
      continue;
    }
    for (const a of c.assets) {
      const h = members.find((m) => m.id === a.holdingId);
      slots.push({
        assetClassId: c.assetClassId,
        holdingId: a.holdingId,
        weight: c.percentBp * a.percentBp,
        valueMinor: h?.valueMinor ?? 0,
        isFd: Boolean(h?.isFd),
      });
    }
    for (const m of members) {
      if (c.assets.some((a) => a.holdingId === m.id)) continue;
      slots.push({
        assetClassId: c.assetClassId,
        holdingId: m.id,
        weight: 0,
        valueMinor: m.valueMinor,
        isFd: Boolean(m.isFd),
      });
    }
  }
  const totalWeight = slots.reduce((s, x) => s + x.weight, 0);
  const targets =
    V > 0 && totalWeight > 0
      ? allocateLargestRemainder(
          V,
          slots.map((s) => s.weight),
        )
      : slots.map(() => 0);
  return slots.map((s, i) => ({
    assetClassId: s.assetClassId,
    holdingId: s.holdingId,
    valueMinor: s.valueMinor,
    targetMinor: targets[i]!,
    tradeMinor: targets[i]! - s.valueMinor,
    isFd: s.isFd,
  }));
}

/** "Invest new money": cashflow rebalance of S (only buys; docs/04 §8). */
export function cashflowPlan(
  S: number,
  tree: AllocationTree,
  holdings: readonly DriftHolding[],
): { assetClassId: string; holdingId: string | null; amountMinor: number }[] {
  if (S <= 0 || tree.length === 0) return [];
  const { universe } = universeOf(tree, holdings);
  const classValues: Record<string, number> = {};
  for (const h of universe)
    classValues[h.assetClassId] = (classValues[h.assetClassId] ?? 0) + h.valueMinor;
  return cashflowSplit(S, tree, classValues).filter((l) => l.amountMinor > 0);
}
