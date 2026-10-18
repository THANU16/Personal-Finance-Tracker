"use server";

import { revalidatePath } from "next/cache";
import { setHideAmounts, updateSettings } from "@/modules/settings/service";
import type { SettingsDTO } from "@/modules/settings/schemas";
import type { ActionResult } from "@/server/action-result";
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
