import { describe, expect, it } from "vitest";
import { getAccountsOverview } from "@/modules/accounts/queries";
import { getAccount, updateAccount } from "@/modules/accounts/service";
import { getSafeToSpend } from "@/modules/dashboard/queries";
import { getBuckets, setEarmark } from "@/modules/earmarks/service";
import {
  completeGoalCycle,
  createGoal,
  deleteGoal,
  listGoals,
  setGoalArchived,
  updateGoal,
} from "@/modules/goals/service";
import { createTransaction, voidTransaction } from "@/modules/transactions/service";
import { AppError } from "@/server/errors";
import type { Ctx } from "@/server/ctx";
import { balanceOf, categoryId, makeAccount, makeUser } from "../helpers/factories";
import { setupTestDb } from "../helpers/test-db";

// Goal savings accounts (owner request, docs/04 §13, §20): an account kept for one goal. Its whole
// balance counts toward the goal, never as free cash or safe to spend; spending from it asks first.

setupTestDb();

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected a rejection");
}

async function setup() {
  const ctx = await makeUser();
  const everyday = await makeAccount(ctx, { name: "Everyday", openingBalanceMinor: 200_000 });
  const goal = await createGoal(ctx, {
    name: "Insurance premium",
    targetMinor: 150_000,
    targetDate: "2027-03-01",
    kind: "recurring",
    recurrence: { every: 1, unit: "year" },
  });
  const pot = await makeAccount(ctx, {
    name: "Insurance pot",
    openingBalanceMinor: 120_000,
    goalId: goal.id,
  });
  return { ctx, everyday, goal, pot };
}

const spend = async (ctx: Ctx, accountId: string, amountMinor: number, flags: object = {}) =>
  createTransaction(ctx, {
    type: "expense",
    date: "2026-02-01",
    amountMinor,
    fromAccountId: accountId,
    categoryId: await categoryId(ctx, "Groceries"),
    ...flags,
  });

describe("goal savings accounts", () => {
  it("count in full toward the goal and show the goal's name", async () => {
    const { ctx, goal, pot } = await setup();
    expect(pot).toMatchObject({ goalId: goal.id, goalName: "Insurance premium" });
    const g = (await listGoals(ctx)).goals[0]!;
    expect(g).toMatchObject({ currentMinor: 120_000, shortfallMinor: 30_000 });
    expect(g.accounts).toEqual([
      expect.objectContaining({ id: pot.id, name: "Insurance pot", countedMinor: 120_000 }),
    ]);
    // Not offered as a "linked item" — it already counts in full.
    expect((await listGoals(ctx)).options.some((o) => o.id === pot.id)).toBe(false);
  });

  it("are never free cash or safe to spend; net worth groups list them as Goal savings", async () => {
    const { ctx, pot } = await setup();
    expect(await getBuckets(ctx)).toEqual([
      { currency: "LKR", emergencyMinor: 0, opportunityMinor: 0, freeMinor: 200_000 },
    ]);
    expect((await getSafeToSpend(ctx)).freeCashMinor).toBe(200_000);
    const { groups } = await getAccountsOverview(ctx);
    expect(groups.map((g) => [g.key, g.accounts.map((a) => a.name)])).toEqual([
      ["cash", ["Everyday"]],
      ["goal_savings", ["Insurance pot"]],
    ]);
    expect(groups.find((g) => g.key === "goal_savings")!.subtotal.totalMinor).toBe(120_000);
    expect(pot.balanceMinor).toBe(120_000);
  });

  it("spending asks first (WITHDRAWS_FROM_GOAL names the goal); confirmGoal lets it through", async () => {
    const { ctx, pot } = await setup();
    const err = await rejection(spend(ctx, pot.id, 50_000));
    expect(err.code).toBe("NEEDS_CONFIRMATION");
    expect(err.warnings).toEqual([
      expect.objectContaining({
        code: "WITHDRAWS_FROM_GOAL",
        amountMinor: 50_000,
        accountName: "Insurance pot",
        goalName: "Insurance premium",
      }),
    ]);
    expect(await balanceOf(ctx, pot.id)).toBe(120_000);
    const { id } = await spend(ctx, pot.id, 50_000, { confirmGoal: true });
    expect(await balanceOf(ctx, pot.id)).toBe(70_000);
    expect((await listGoals(ctx)).goals[0]!.currentMinor).toBe(70_000);
    // Voids are never guarded; the balance comes back.
    await voidTransaction(ctx, id, { reason: "test" });
    expect(await balanceOf(ctx, pot.id)).toBe(120_000);
  });

  it("money coming in (a top-up transfer) is not guarded; a transfer out is", async () => {
    const { ctx, everyday, pot } = await setup();
    await createTransaction(ctx, {
      type: "transfer",
      date: "2026-02-01",
      amountMinor: 30_000,
      fromAccountId: everyday.id,
      toAccountId: pot.id,
    });
    expect((await listGoals(ctx)).goals[0]).toMatchObject({
      currentMinor: 150_000,
      status: "achieved",
    });
    const out = await rejection(
      createTransaction(ctx, {
        type: "transfer",
        date: "2026-02-02",
        amountMinor: 10_000,
        fromAccountId: pot.id,
        toAccountId: everyday.id,
      }),
    );
    expect(out.warnings?.[0]?.code).toBe("WITHDRAWS_FROM_GOAL");
  });

  it("completing a cycle records the account balance as progress", async () => {
    const { ctx, goal, pot } = await setup();
    await spend(ctx, pot.id, 120_000, { confirmGoal: true });
    await completeGoalCycle(ctx, goal.id);
    const g = (await listGoals(ctx)).goals[0]!;
    expect(g.cycles[0]).toMatchObject({ currentAtCloseMinor: 0, status: "completed" });
    expect(g.targetDate).toBe("2028-03-01");
  });

  it("archiving or deleting the goal turns the account back into normal money", async () => {
    const { ctx, goal, pot } = await setup();
    await setGoalArchived(ctx, goal.id, true);
    expect(await getAccount(ctx, pot.id)).toMatchObject({ goalId: null, goalName: null });
    expect((await getBuckets(ctx))[0]!.freeMinor).toBe(320_000);
    await spend(ctx, pot.id, 1_000); // no question any more

    const other = await createGoal(ctx, { name: "Trip", targetMinor: 1, targetDate: "2027-01-01" });
    await updateAccount(ctx, pot.id, { goalId: other.id });
    expect((await getAccount(ctx, pot.id)).goalName).toBe("Trip");
    await deleteGoal(ctx, other.id);
    expect((await getAccount(ctx, pot.id)).goalId).toBeNull();
  });
});

describe("goal savings accounts — what is refused", () => {
  it("only bank, cash and wallet; not together with the emergency flag", async () => {
    const { ctx, goal } = await setup();
    const card = await rejection(
      makeAccount(ctx, {
        type: "credit_card",
        goalId: goal.id,
        creditCard: { limitMinor: 1, statementDay: 1, dueDay: 1 },
      }),
    );
    expect(card.fieldErrors?.goalId?.[0]).toMatch(/bank, cash and wallet/);
    const both = await rejection(
      makeAccount(ctx, { goalId: goal.id, countsTowardEmergencyFund: true }),
    );
    expect(both.fieldErrors?.goalId?.[0]).toMatch(/emergency/);
  });

  it("another user's goal or an archived goal", async () => {
    const { ctx, goal } = await setup();
    const stranger = await makeUser();
    expect((await rejection(makeAccount(stranger, { goalId: goal.id }))).code).toBe("NOT_FOUND");
    const old = await createGoal(ctx, { name: "Old", targetMinor: 1, targetDate: "2027-01-01" });
    await setGoalArchived(ctx, old.id, true);
    expect((await rejection(makeAccount(ctx, { goalId: old.id }))).code).toBe("CONFLICT");
  });

  it("an account with earmarks, or one a goal links by a share", async () => {
    const { ctx, everyday, goal } = await setup();
    await setEarmark(ctx, {
      accountId: everyday.id,
      bucket: "emergency",
      mode: "fixed",
      amountMinor: 10_000,
    });
    const earmarked = await rejection(updateAccount(ctx, everyday.id, { goalId: goal.id }));
    expect(earmarked.message).toMatch(/earmarks/);

    const savings = await makeAccount(ctx, { name: "Savings", openingBalanceMinor: 50_000 });
    await createGoal(ctx, {
      name: "Car",
      targetMinor: 1,
      targetDate: "2027-01-01",
      links: [{ kind: "account", refId: savings.id, shareBp: 5_000 }],
    });
    const linked = await rejection(updateAccount(ctx, savings.id, { goalId: goal.id }));
    expect(linked.message).toMatch(/linked to "Car"/);
  });

  it("a goal cannot link a goal savings account by a share; earmarks on it are refused", async () => {
    const { ctx, goal, pot } = await setup();
    const err = await rejection(
      updateGoal(ctx, goal.id, {
        name: "Insurance premium",
        targetMinor: 150_000,
        targetDate: "2027-03-01",
        kind: "recurring",
        recurrence: { every: 1, unit: "year" },
        links: [{ kind: "account", refId: pot.id, shareBp: 10_000 }],
      }),
    );
    expect(err.fieldErrors?.["links.0.refId"]?.[0]).toMatch(/counts in full/);
    const earmark = await rejection(
      setEarmark(ctx, { accountId: pot.id, bucket: "emergency", mode: "fixed", amountMinor: 1 }),
    );
    expect(earmark.message).toMatch(/kept for a goal/);
  });

  it("bucket tags cannot use a goal savings account", async () => {
    const { ctx, pot } = await setup();
    const err = await rejection(
      spend(ctx, pot.id, 1_000, { confirmGoal: true, fromBucket: "emergency" }),
    );
    expect(err.code).toBe("VALIDATION");
    expect(await balanceOf(ctx, pot.id)).toBe(120_000);
  });
});
