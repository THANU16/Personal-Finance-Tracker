"use server";

import { revalidatePath } from "next/cache";
import type { HoldingDTO } from "@/modules/holdings/schemas";
import {
  bulkUpdateValues,
  closeHolding,
  createHolding,
  deleteValuation,
  recordValuation,
  renewFd,
  reopenHolding,
  updateHolding,
  withdrawFd,
} from "@/modules/holdings/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

// Holding values feed accounts (cash legs), assets and the dashboard: refresh the app layout.
const refresh = () => revalidatePath("/", "layout");

async function act<T>(
  fn: (ctx: Awaited<ReturnType<typeof requireUser>>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAction(async () => {
    const result = await fn(await requireUser());
    refresh();
    return result;
  });
}

export async function createHoldingAction(input: unknown): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => createHolding(ctx, input));
}

export async function updateHoldingAction(
  id: string,
  input: unknown,
): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => updateHolding(ctx, id, input));
}

export async function recordValuationAction(
  id: string,
  input: unknown,
): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => recordValuation(ctx, id, input));
}

export async function bulkUpdateValuesAction(
  input: unknown,
): Promise<ActionResult<{ updated: number }>> {
  return act((ctx) => bulkUpdateValues(ctx, input));
}

export async function deleteValuationAction(
  holdingId: string,
  valuationId: string,
): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => deleteValuation(ctx, holdingId, valuationId));
}

export async function closeHoldingAction(
  id: string,
  input: unknown,
): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => closeHolding(ctx, id, input));
}

export async function reopenHoldingAction(id: string): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => reopenHolding(ctx, id));
}

export async function withdrawFdAction(
  id: string,
  input: unknown,
): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => withdrawFd(ctx, id, input));
}

export async function renewFdAction(id: string, input: unknown): Promise<ActionResult<HoldingDTO>> {
  return act((ctx) => renewFd(ctx, id, input));
}
