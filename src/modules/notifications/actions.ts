"use server";

import { revalidatePath } from "next/cache";
import { markAllRead, markRead, snooze } from "@/modules/notifications/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markReadAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await markRead(await requireUser(), id);
    revalidate();
    return r;
  });
}

export async function markAllReadAction(): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const r = await markAllRead(await requireUser());
    revalidate();
    return r;
  });
}

export async function snoozeAction(
  id: string,
  days: unknown,
): Promise<ActionResult<{ id: string; until: string }>> {
  return runAction(async () => {
    const r = await snooze(await requireUser(), id, days);
    revalidate();
    return r;
  });
}
