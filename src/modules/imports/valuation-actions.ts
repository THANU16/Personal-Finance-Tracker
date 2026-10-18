"use server";

import { revalidatePath } from "next/cache";
import { rebuildHistory } from "@/modules/snapshots/service";
import {
  analyzeValuationFile,
  commitValuationImport,
  undoValuationImport,
  type ValuationImportAnalysis,
  type ValuationImportResult,
} from "@/modules/imports/valuation-service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  for (const p of [
    "/assets",
    "/accounts",
    "/transactions",
    "/dashboard",
    "/settings",
    "/rebalancing",
  ])
    revalidatePath(p);
  revalidatePath("/assets/[id]", "page");
}

/** Reads one CSV (nothing is saved). */
export async function analyzeValuationFileAction(
  input: unknown,
): Promise<ActionResult<ValuationImportAnalysis>> {
  return runAction(async () => analyzeValuationFile(await requireUser(), input));
}

export async function commitValuationImportAction(
  input: unknown,
): Promise<ActionResult<ValuationImportResult>> {
  return runAction(async () => {
    const r = await commitValuationImport(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function undoValuationImportAction(
  batchId: string,
): Promise<ActionResult<{ voided: number; valuationsRemoved: number }>> {
  return runAction(async () => {
    const r = await undoValuationImport(await requireUser(), batchId);
    revalidate();
    return r;
  });
}

/** "Rebuild net-worth history" after an import (month-end snapshots from the ledger). */
export async function rebuildAfterImportAction(): Promise<ActionResult<{ months: number }>> {
  return runAction(async () => {
    const r = await rebuildHistory(await requireUser());
    revalidatePath("/dashboard");
    return r;
  });
}
