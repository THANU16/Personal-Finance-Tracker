"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { revokeOtherSessions, revokeSessionById } from "@/modules/settings/security";
import { setHideAmounts, updateSettings } from "@/modules/settings/service";
import type { SettingsDTO } from "@/modules/settings/schemas";
import { parseInput, type ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function updateSettingsAction(input: unknown): Promise<ActionResult<SettingsDTO>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const settings = await updateSettings(ctx, input);
    revalidatePath("/", "layout");
    return settings;
  });
}

export async function setHideAmountsAction(input: unknown): Promise<ActionResult<SettingsDTO>> {
  return runAction(async () => {
    const ctx = await requireUser();
    return setHideAmounts(ctx, input);
  });
}

const sessionIdSchema = z.string().min(1).max(128);

export async function revokeSessionAction(sessionId: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await requireUser();
    await revokeSessionById(parseInput(sessionIdSchema, sessionId));
    revalidatePath("/settings");
    return null;
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult<null>> {
  return runAction(async () => {
    await requireUser();
    await revokeOtherSessions();
    revalidatePath("/settings");
    return null;
  });
}
