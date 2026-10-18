"use server";

import { revalidatePath } from "next/cache";
import { getCashflowPlan, tiltNextSip, type NextSip } from "@/modules/rebalancing/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function cashflowPlanAction(
  amountMinor: unknown,
): Promise<
  ActionResult<{ assetClassId: string; holdingId: string | null; amountMinor: number }[]>
> {
  return runAction(async () => getCashflowPlan(await requireUser(), amountMinor));
}

export async function tiltNextSipAction(planId: unknown): Promise<ActionResult<NextSip>> {
  return runAction(async () => {
    const result = await tiltNextSip(await requireUser(), planId);
    revalidatePath("/sip");
    revalidatePath("/rebalancing");
    return result;
  });
}
