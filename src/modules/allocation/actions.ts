"use server";

import { revalidatePath } from "next/cache";
import type { TargetDTO } from "@/modules/allocation/schemas";
import { saveTarget } from "@/modules/allocation/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function saveTargetAction(
  input: unknown,
): Promise<ActionResult<TargetDTO & { warnings: string[] }>> {
  return runAction(async () => {
    const result = await saveTarget(await requireUser(), input);
    // The target drives SIP plans that follow it, rebalancing and the dashboard.
    revalidatePath("/", "layout");
    return result;
  });
}
