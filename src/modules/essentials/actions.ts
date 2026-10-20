"use server";

import { revalidatePath } from "next/cache";
import {
  createPolicy,
  deletePolicy,
  setPolicyStatus,
  updatePolicy,
  useEmergencyFund,
} from "@/modules/essentials/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  revalidatePath("/essentials");
  revalidatePath("/dashboard");
}

export async function savePolicyAction(
  id: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const r = id ? await updatePolicy(ctx, id, input) : await createPolicy(ctx, input);
    revalidate();
    return r;
  });
}

export async function setPolicyStatusAction(
  id: string,
  status: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await setPolicyStatus(await requireUser(), id, status);
    revalidate();
    return r;
  });
}

export async function deletePolicyAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await deletePolicy(await requireUser(), id);
    revalidate();
    return r;
  });
}

/** "Use emergency fund" (expense or transfer that reduces the emergency earmark). */
export async function spendEmergencyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await useEmergencyFund(await requireUser(), input);
    revalidate();
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    return r;
  });
}
