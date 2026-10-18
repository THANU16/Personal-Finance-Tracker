"use server";

import { revalidatePath } from "next/cache";
import {
  confirmRule,
  createRule,
  setRuleStatus,
  skipRule,
  updateRule,
} from "@/modules/recurring/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate(ledger = false) {
  revalidatePath("/recurring");
  revalidatePath("/dashboard");
  if (ledger)
    for (const p of ["/transactions", "/accounts", "/budgets", "/debts", "/reports"])
      revalidatePath(p);
}

export async function createRuleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await createRule(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function updateRuleAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await updateRule(await requireUser(), id, input);
    revalidate();
    return r;
  });
}

export async function setRuleStatusAction(
  id: string,
  status: "active" | "paused" | "ended",
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await setRuleStatus(await requireUser(), id, status);
    revalidate();
    return r;
  });
}

export async function confirmRuleAction(
  id: string,
  input: unknown,
): Promise<
  ActionResult<{ transactionId: string; nextDueDate: string | null; warnings: string[] }>
> {
  return runAction(async () => {
    const r = await confirmRule(await requireUser(), id, input);
    revalidate(true);
    return r;
  });
}

export async function skipRuleAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ nextDueDate: string | null }>> {
  return runAction(async () => {
    const r = await skipRule(await requireUser(), id, input);
    revalidate();
    return r;
  });
}
