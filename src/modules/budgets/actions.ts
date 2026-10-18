"use server";

import { revalidatePath } from "next/cache";
import { copyLastMonth, removeBudget, setBudget } from "@/modules/budgets/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}

export async function setBudgetAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  return runAction(async () => {
    const r = await setBudget(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function removeBudgetAction(input: unknown): Promise<ActionResult<{ removed: true }>> {
  return runAction(async () => {
    const r = await removeBudget(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function copyLastMonthAction(
  month: string,
): Promise<ActionResult<{ copied: number }>> {
  return runAction(async () => {
    const r = await copyLastMonth(await requireUser(), month);
    revalidate();
    return r;
  });
}
