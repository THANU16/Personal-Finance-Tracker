"use server";

import { revalidatePath } from "next/cache";
import {
  analyzeBankCsv,
  commitBankImport,
  previewBankImport,
  undoBankImport,
  type BankAnalysis,
  type BankImportResult,
  type BankPreview,
} from "@/modules/imports/bank-service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  for (const p of [
    "/accounts",
    "/transactions",
    "/dashboard",
    "/settings",
    "/budgets",
    "/transactions/import",
  ]) {
    revalidatePath(p);
  }
}

/** Reads the file: headers, sample and a mapping (nothing is saved). */
export async function analyzeBankCsvAction(input: unknown): Promise<ActionResult<BankAnalysis>> {
  return runAction(async () => analyzeBankCsv(await requireUser(), input));
}

export async function previewBankImportAction(input: unknown): Promise<ActionResult<BankPreview>> {
  return runAction(async () => previewBankImport(await requireUser(), input));
}

export async function commitBankImportAction(
  input: unknown,
): Promise<ActionResult<BankImportResult>> {
  return runAction(async () => {
    const r = await commitBankImport(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function undoBankImportAction(
  batchId: string,
): Promise<ActionResult<{ voided: number }>> {
  return runAction(async () => {
    const r = await undoBankImport(await requireUser(), batchId);
    revalidate();
    return r;
  });
}
