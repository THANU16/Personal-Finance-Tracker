"use server";

import { revalidatePath } from "next/cache";
import type { AssetClassDTO } from "@/modules/asset-classes/schemas";
import {
  archiveAssetClass,
  createAssetClass,
  updateAssetClass,
} from "@/modules/asset-classes/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

const refresh = () => revalidatePath("/settings");

export async function createAssetClassAction(input: unknown): Promise<ActionResult<AssetClassDTO>> {
  return runAction(async () => {
    const result = await createAssetClass(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function updateAssetClassAction(
  id: string,
  input: unknown,
): Promise<ActionResult<AssetClassDTO>> {
  return runAction(async () => {
    const result = await updateAssetClass(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export async function archiveAssetClassAction(id: string): Promise<ActionResult<AssetClassDTO>> {
  return runAction(async () => {
    const result = await archiveAssetClass(await requireUser(), id);
    refresh();
    return result;
  });
}
