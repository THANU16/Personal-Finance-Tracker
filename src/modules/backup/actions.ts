"use server";

import { revalidatePath } from "next/cache";
import { rebuildHistory } from "@/modules/snapshots/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { recomputeAllForUser } from "@/server/ledger/recompute-all";
import { runAction } from "@/server/run-action";

// Settings → Data maintenance (docs/05 §17). Backup export/restore go through /api/export and /api/import.

export async function rebuildSnapshotsAction(): Promise<ActionResult<{ months: number }>> {
  return runAction(async () => {
    const r = await rebuildHistory(await requireUser());
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return r;
  });
}

export async function recomputeCachesAction(): Promise<
  ActionResult<{ accounts: number; holdings: number; changed: number }>
> {
  return runAction(async () => {
    const r = await recomputeAllForUser(await requireUser());
    revalidatePath("/", "layout");
    return r;
  });
}
