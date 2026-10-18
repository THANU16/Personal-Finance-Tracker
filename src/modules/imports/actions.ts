"use server";

import { revalidatePath } from "next/cache";
import type { ImportResult, PreviewData } from "@/modules/imports/schemas";
import {
  commitImport,
  previewImport,
  saveImportMapping,
  undoImport,
} from "@/modules/imports/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function saveImportMappingAction(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  return runAction(async () => saveImportMapping(await requireUser(), input));
}

/** Saves the mapping, then runs the dry run (nothing is posted). */
export async function previewImportAction(input: unknown): Promise<ActionResult<PreviewData>> {
  return runAction(async () => {
    const ctx = await requireUser();
    await saveImportMapping(ctx, input);
    return previewImport(ctx, (input as { batchId?: unknown } | null)?.batchId);
  });
}

function revalidateLedger() {
  for (const path of ["/transactions", "/accounts", "/assets", "/dashboard", "/reports"]) {
    revalidatePath(path);
  }
  revalidatePath("/transactions/import", "layout");
}

export async function commitImportAction(input: unknown): Promise<ActionResult<ImportResult>> {
  return runAction(async () => {
    const result = await commitImport(await requireUser(), input);
    revalidateLedger();
    return result;
  });
}

export async function undoImportAction(
  input: unknown,
): Promise<ActionResult<{ voided: number; archived: number }>> {
  return runAction(async () => {
    const result = await undoImport(await requireUser(), input);
    revalidateLedger();
    return result;
  });
}
