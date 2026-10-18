"use server";

import { revalidatePath } from "next/cache";
import type { CategoryDTO } from "@/modules/categories/schemas";
import {
  archiveCategory,
  createCategory,
  unarchiveCategory,
  updateCategory,
} from "@/modules/categories/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

const refresh = () => revalidatePath("/", "layout");

export async function createCategoryAction(input: unknown): Promise<ActionResult<CategoryDTO>> {
  return runAction(async () => {
    const result = await createCategory(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function updateCategoryAction(
  id: string,
  input: unknown,
): Promise<ActionResult<CategoryDTO>> {
  return runAction(async () => {
    const result = await updateCategory(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export async function archiveCategoryAction(id: string): Promise<ActionResult<CategoryDTO>> {
  return runAction(async () => {
    const result = await archiveCategory(await requireUser(), id);
    refresh();
    return result;
  });
}

export async function unarchiveCategoryAction(id: string): Promise<ActionResult<CategoryDTO>> {
  return runAction(async () => {
    const result = await unarchiveCategory(await requireUser(), id);
    refresh();
    return result;
  });
}
