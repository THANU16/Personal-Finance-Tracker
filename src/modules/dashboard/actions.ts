"use server";

import { revalidatePath } from "next/cache";
import { createManualSnapshot, rebuildHistory } from "@/modules/snapshots/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

/** "Rebuild history": recompute every month-end snapshot from the ledger (docs/04 §16). */
export async function rebuildHistoryAction(): Promise<ActionResult<{ months: number }>> {
  return runAction(async () => {
    const result = await rebuildHistory(await requireUser());
    revalidatePath("/dashboard");
    return result;
  });
}

export async function createManualSnapshotAction(): Promise<ActionResult<{ date: string }>> {
  return runAction(async () => {
    const snap = await createManualSnapshot(await requireUser());
    revalidatePath("/dashboard");
    return { date: snap.date };
  });
}
