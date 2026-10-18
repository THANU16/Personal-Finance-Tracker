"use server";

import { revalidatePath } from "next/cache";
import { createGoal, deleteGoal, setGoalArchived, updateGoal } from "@/modules/goals/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

export async function saveGoalAction(
  id: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const r = id ? await updateGoal(ctx, id, input) : await createGoal(ctx, input);
    revalidate();
    return r;
  });
}

export async function archiveGoalAction(
  id: string,
  archived: boolean,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await setGoalArchived(await requireUser(), id, archived);
    revalidate();
    return r;
  });
}

export async function deleteGoalAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await deleteGoal(await requireUser(), id);
    revalidate();
    return r;
  });
}
