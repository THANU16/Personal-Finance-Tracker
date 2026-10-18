"use server";

import { revalidatePath } from "next/cache";
import type { PrepaymentPreviewDTO } from "@/modules/debts/schemas";
import {
  createDebt,
  previewPrepayment,
  recordPayment,
  recordPrepayment,
  settleCounterparty,
  updateDebt,
} from "@/modules/debts/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

function revalidate() {
  for (const p of ["/debts", "/accounts", "/transactions", "/dashboard", "/reports"])
    revalidatePath(p);
  revalidatePath("/debts/[id]", "page");
}

export async function createDebtAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await createDebt(await requireUser(), input);
    revalidate();
    return r;
  });
}

export async function updateDebtAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await updateDebt(await requireUser(), id, input);
    revalidate();
    return r;
  });
}

export async function recordPaymentAction(
  id: string,
  input: unknown,
): Promise<
  ActionResult<{
    transactionId: string;
    principalMinor: number;
    interestMinor: number;
    warnings: string[];
  }>
> {
  return runAction(async () => {
    const r = await recordPayment(await requireUser(), id, input);
    revalidate();
    return r;
  });
}

export async function previewPrepaymentAction(
  id: string,
  input: unknown,
): Promise<ActionResult<PrepaymentPreviewDTO>> {
  return runAction(async () => previewPrepayment(await requireUser(), id, input));
}

export async function recordPrepaymentAction(
  id: string,
  input: unknown,
): Promise<ActionResult<PrepaymentPreviewDTO>> {
  return runAction(async () => {
    const r = await recordPrepayment(await requireUser(), id, input);
    revalidate();
    return r;
  });
}

export async function settleCounterpartyAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await settleCounterparty(await requireUser(), input);
    revalidate();
    return r;
  });
}
