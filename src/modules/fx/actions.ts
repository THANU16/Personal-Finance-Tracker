"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FxRateDTO } from "@/modules/fx/schemas";
import { deleteFxRate, saveFxRate } from "@/modules/fx/service";
import { parseInput, type ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

// Rates change converted totals everywhere (dashboard, accounts, portfolio).
const refresh = () => revalidatePath("/", "layout");
const idSchema = z.string().min(1).max(64);

export async function saveFxRateAction(
  input: unknown,
  id?: unknown,
): Promise<ActionResult<FxRateDTO>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const result = await saveFxRate(
      ctx,
      input,
      id === undefined ? undefined : parseInput(idSchema, id),
    );
    refresh();
    return result;
  });
}

export async function deleteFxRateAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await deleteFxRate(await requireUser(), parseInput(idSchema, id));
    refresh();
    return null;
  });
}
