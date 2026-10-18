"use server";

import { revalidatePath } from "next/cache";
import type { DeploymentDTO, DeploymentPreviewLine } from "@/modules/opportunity-fund/schemas";
import {
  addMarketLevel,
  deleteMarketLevel,
  previewDeployment,
  recordDeployment,
  saveFundSettings,
  undoDeployment,
} from "@/modules/opportunity-fund/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate(ledger = false) {
  revalidatePath("/opportunity-fund");
  revalidatePath("/dashboard");
  if (ledger) {
    for (const p of ["/accounts", "/assets", "/transactions", "/rebalancing"]) revalidatePath(p);
  }
}

export async function saveFundSettingsAction(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  return runAction(async () => {
    const r = await saveFundSettings(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function addMarketLevelAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await addMarketLevel(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function deleteMarketLevelAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await deleteMarketLevel(await requireUser(), id);
    revalidate();
    return r;
  });
}

export async function previewDeploymentAction(
  input: unknown,
): Promise<ActionResult<DeploymentPreviewLine[]>> {
  return runAction(async () => previewDeployment(await requireUser(), input));
}

export async function recordDeploymentAction(input: unknown): Promise<ActionResult<DeploymentDTO>> {
  return runAction(async () => {
    const r = await recordDeployment(await requireUser(), input);
    revalidate(true);
    return r;
  });
}

export async function undoDeploymentAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await undoDeployment(await requireUser(), id);
    revalidate(true);
    return r;
  });
}
