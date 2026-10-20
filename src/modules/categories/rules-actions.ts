"use server";

import { revalidatePath } from "next/cache";
import {
  createCategoryRule,
  deleteCategoryRule,
  updateCategoryRule,
} from "@/modules/categories/rules-service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function saveCategoryRuleAction(
  id: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const r = id ? await updateCategoryRule(ctx, id, input) : await createCategoryRule(ctx, input);
    revalidatePath("/settings");
    return r;
  });
}

export async function deleteCategoryRuleAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await deleteCategoryRule(await requireUser(), id);
    revalidatePath("/settings");
    return r;
  });
}
