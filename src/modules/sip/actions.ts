"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ExecutionDTO, PlanDTO } from "@/modules/sip/schemas";
import {
  createPlan,
  executeSip,
  setPlanStatus,
  skipSip,
  undoSip,
  updatePlan,
} from "@/modules/sip/service";
import { parseInput, type ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

// SIP executions move money and holdings: refresh the whole app layout.
const refresh = () => revalidatePath("/", "layout");
const id = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export async function createPlanAction(
  input: unknown,
): Promise<ActionResult<{ plan: PlanDTO; warnings: string[] }>> {
  return runAction(async () => {
    const result = await createPlan(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function updatePlanAction(
  planId: unknown,
  input: unknown,
): Promise<
  ActionResult<{
    plan: PlanDTO;
    newVersion: number | null;
    effectiveFrom: string | null;
    warnings: string[];
  }>
> {
  return runAction(async () => {
    const result = await updatePlan(await requireUser(), parseInput(id, planId), input);
    refresh();
    return result;
  });
}

export async function setPlanStatusAction(
  planId: unknown,
  status: unknown,
): Promise<ActionResult<PlanDTO>> {
  return runAction(async () => {
    const s = parseInput(z.enum(["active", "paused", "ended"]), status);
    const result = await setPlanStatus(await requireUser(), parseInput(id, planId), s);
    refresh();
    return result;
  });
}

export async function executeSipAction(
  executionId: unknown,
  input: unknown,
): Promise<ActionResult<{ execution: ExecutionDTO; warnings: string[] }>> {
  return runAction(async () => {
    const result = await executeSip(await requireUser(), parseInput(id, executionId), input);
    refresh();
    return result;
  });
}

export async function skipSipAction(
  executionId: unknown,
  input: unknown,
): Promise<ActionResult<ExecutionDTO>> {
  return runAction(async () => {
    const result = await skipSip(await requireUser(), parseInput(id, executionId), input);
    refresh();
    return result;
  });
}

export async function undoSipAction(executionId: unknown): Promise<ActionResult<ExecutionDTO>> {
  return runAction(async () => {
    const result = await undoSip(await requireUser(), parseInput(id, executionId));
    refresh();
    return result;
  });
}
