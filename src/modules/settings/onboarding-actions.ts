"use server";

import { revalidatePath } from "next/cache";
import { completeOnboarding, loadDemoData } from "@/modules/settings/onboarding";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function completeOnboardingAction(): Promise<ActionResult<{ done: true }>> {
  return runAction(async () => {
    const r = await completeOnboarding(await requireUser());
    revalidatePath("/", "layout");
    return r;
  });
}

/** Development only (the service refuses in production). */
export async function loadDemoDataAction(): Promise<ActionResult<{ transactions: number }>> {
  return runAction(async () => {
    const r = await loadDemoData(await requireUser());
    revalidatePath("/", "layout");
    return r;
  });
}
