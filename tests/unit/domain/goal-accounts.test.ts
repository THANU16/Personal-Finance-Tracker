import { describe, expect, it } from "vitest";
import {
  GOAL_ACCOUNT_TYPES,
  canCarryEarmarks,
  dedicatedBucket,
  isEarmarkable,
  isGoalAccount,
  isSpendableCash,
} from "@/domain/earmarks";

// Goal savings accounts (owner request, docs/04 §20): the whole balance is goal money.
const bank = { type: "bank" as const, countsTowardEmergencyFund: false, balanceMinor: 100_000 };

describe("goal savings accounts", () => {
  it("are recognised by goalId", () => {
    expect(isGoalAccount({ goalId: "g1" })).toBe(true);
    expect(isGoalAccount({ goalId: null })).toBe(false);
    expect(isGoalAccount({})).toBe(false);
  });

  it("carry no earmarks and are never spendable free cash", () => {
    const kept = { ...bank, goalId: "g1" };
    expect(canCarryEarmarks(kept)).toBe(false);
    expect(isEarmarkable(kept)).toBe(false);
    expect(isSpendableCash(kept)).toBe(false);
    // Not an emergency / opportunity account either.
    expect(dedicatedBucket(kept)).toBeNull();
    // The same account without a goal is normal money.
    expect(isSpendableCash(bank)).toBe(true);
  });

  it("only bank, cash and wallet accounts can be kept for a goal", () => {
    expect([...GOAL_ACCOUNT_TYPES].sort()).toEqual(["bank", "cash", "wallet"]);
  });
});
