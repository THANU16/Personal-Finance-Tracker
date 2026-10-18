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
  /** Emergency-fund holding: counted in the weights, never traded by rebalancing. */
  locked: boolean;
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
  /** Value of emergency-fund holdings inside the universe (counted, locked from trades). */
  lockedEmergencyMinor: number;
  flaggedCount: number;
}

const share = (part: number, whole: number) => (whole > 0 ? mulDivRound(part, BP_SCALE, whole) : 0);

/**
 * The rebalancing universe (owner decision): active holdings whose class is in the target,
 * emergency-fund holdings included so weights match reality; those are `locked` (never traded).
 */
export function universeOf(tree: AllocationTree, holdings: readonly DriftHolding[]) {
  const inTarget = new Set(tree.map((c) => c.assetClassId));
  const active = holdings.filter((h) => h.active && h.valueMinor > 0);
  const universe = active.filter((h) => inTarget.has(h.assetClassId));
  return {
    universe,
    outsideHoldings: active.filter((h) => !inTarget.has(h.assetClassId)),
    locked: new Set(universe.filter((h) => h.countsTowardEmergencyFund).map((h) => h.id)),
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
  const { universe, outsideHoldings, locked } = universeOf(tree, holdings);
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
        locked: locked.has(id),
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
    lockedEmergencyMinor: universe
      .filter((h) => locked.has(h.id))
      .reduce((s, h) => s + h.valueMinor, 0),
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
  /** Emergency-fund holding: kept as it is (trade 0). */
  locked: boolean;
}

interface Slot {
  assetClassId: string;
  holdingId: string | null;
  weight: number;
  /** Value the trade applies to (unlocked part). */
  valueMinor: number;
  /** Locked value inside the slot: a locked holding, or locked members of a class-level slot. */
  lockedMinor: number;
  locked: boolean;
  isFd: boolean;
}

/**
 * Full rebalance: ideal target_i = weight_i × V (largest remainder). Locked emergency-fund holdings
 * keep their value (trade 0) and count toward their own class's target first; each class's
 * remaining target goes to its tradable holdings, scaled so Σ targets = V and Σ trades = 0 exactly.
 */
export function fullRebalance(
  tree: AllocationTree,
  holdings: readonly DriftHolding[],
): TradeLine[] {
  const { universe, locked } = universeOf(tree, holdings);
  const V = universe.reduce((s, h) => s + h.valueMinor, 0);
  const slots: Slot[] = [];
  for (const c of tree) {
    const members = universe.filter((h) => h.assetClassId === c.assetClassId);
    if (c.assets.length === 0) {
      const lockedMembers = members.filter((m) => locked.has(m.id));
      slots.push({
        assetClassId: c.assetClassId,
        holdingId: null,
        weight: c.percentBp * BP_SCALE,
        valueMinor: members.filter((m) => !locked.has(m.id)).reduce((s, h) => s + h.valueMinor, 0),
        lockedMinor: 0, // locked members are their own (locked) lines below
        locked: false,
        isFd: false,
      });
      for (const m of lockedMembers) {
        slots.push({
          assetClassId: c.assetClassId,
          holdingId: m.id,
          weight: 0,
          valueMinor: m.valueMinor,
          lockedMinor: 0,
          locked: true,
          isFd: Boolean(m.isFd),
        });
      }
      continue;
    }
    for (const a of c.assets) {
      const h = members.find((m) => m.id === a.holdingId);
      slots.push({
        assetClassId: c.assetClassId,
        holdingId: a.holdingId,
        weight: c.percentBp * a.percentBp,
        valueMinor: h?.valueMinor ?? 0,
        lockedMinor: 0,
        locked: locked.has(a.holdingId),
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
        lockedMinor: 0,
        locked: locked.has(m.id),
        isFd: Boolean(m.isFd),
      });
    }
  }
  const totalWeight = slots.reduce((s, x) => s + x.weight, 0);
  if (!(V > 0 && totalWeight > 0)) {
    return slots.map((x) => ({
      ...line(x),
      targetMinor: x.locked ? x.valueMinor : 0,
      tradeMinor: x.locked ? 0 : -x.valueMinor,
    }));
  }
  const ideal = allocateLargestRemainder(
    V,
    slots.map((x) => x.weight),
  );
  // Per class: locked emergency money counts toward the class target first; the rest of the class
  // target goes to its tradable slots. Classes are then scaled so the tradable total is exactly V − L.
  const classIds = [...new Set(slots.map((x) => x.assetClassId))];
  const free = V - slots.reduce((s, x) => s + (x.locked ? x.valueMinor : x.lockedMinor), 0);
  const want = classIds.map((id) => {
    const inClass = slots.map((x, i) => ({ x, i })).filter((e) => e.x.assetClassId === id);
    const tradable = inClass.filter((e) => !e.x.locked);
    if (!tradable.length) return 0;
    const classIdeal = inClass.reduce((s, e) => s + ideal[e.i]!, 0);
    const lockedInClass = inClass.reduce(
      (s, e) => s + (e.x.locked ? e.x.valueMinor : e.x.lockedMinor),
      0,
    );
    return Math.max(0, classIdeal - lockedInClass);
  });
  const classFree =
    free <= 0
      ? classIds.map(() => 0)
      : want.some((w) => w > 0)
        ? allocateLargestRemainder(free, want)
        : allocateLargestRemainder(
            free,
            classIds.map((id) => (slots.some((x) => x.assetClassId === id && !x.locked) ? 1 : 0)),
          );
  const targets = slots.map((x) => (x.locked ? x.valueMinor : 0));
  classIds.forEach((id, ci) => {
    const tradable = slots
      .map((x, i) => ({ x, i }))
      .filter((e) => e.x.assetClassId === id && !e.x.locked);
    if (!tradable.length) return;
    const keys = tradable.map((e) => ideal[e.i]!);
    const split = allocateLargestRemainder(
      classFree[ci]!,
      keys.some((k) => k > 0) ? keys : tradable.map(() => 1),
    );
    tradable.forEach((e, j) => (targets[e.i] = split[j]!));
  });
  return slots.map((x, i) => ({
    ...line(x),
    targetMinor: targets[i]!,
    tradeMinor: targets[i]! - x.valueMinor,
  }));
}

function line(x: Slot): Omit<TradeLine, "targetMinor" | "tradeMinor"> {
  return {
    assetClassId: x.assetClassId,
    holdingId: x.holdingId,
    valueMinor: x.valueMinor,
    isFd: x.isFd,
    locked: x.locked,
  };
}

/** "Invest new money": cashflow rebalance of S (only buys; docs/04 §8). */
export function cashflowPlan(
  S: number,
  tree: AllocationTree,
  holdings: readonly DriftHolding[],
): { assetClassId: string; holdingId: string | null; amountMinor: number }[] {
  if (S <= 0 || tree.length === 0) return [];
  const { universe, locked } = universeOf(tree, holdings);
  const classValues: Record<string, number> = {};
  for (const h of universe)
    classValues[h.assetClassId] = (classValues[h.assetClassId] ?? 0) + h.valueMinor;
  // New money never goes into a locked emergency-fund holding: its class share is split over the
  // class's other target holdings (or picked when applying if it has none).
  const buyable: AllocationTree = tree.map((c) => {
    const assets = c.assets.filter((a) => !locked.has(a.holdingId));
    if (assets.length === c.assets.length) return c;
    const bp = assets.length
      ? allocateLargestRemainder(
          BP_SCALE,
          assets.map((a) => a.percentBp || 1),
        )
      : [];
    return { ...c, assets: assets.map((a, i) => ({ ...a, percentBp: bp[i]! })) };
  });
  return cashflowSplit(S, buyable, classValues).filter((l) => l.amountMinor > 0);
}
