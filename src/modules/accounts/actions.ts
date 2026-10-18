"use server";

import { revalidatePath } from "next/cache";
import type { AccountDTO } from "@/modules/accounts/schemas";
import {
  archiveAccount,
  createAccount,
  reconcileAccount,
  unarchiveAccount,
  updateAccount,
} from "@/modules/accounts/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

// Balances feed several pages (accounts, transactions, dashboard), so refresh the app layout.
const refresh = () => revalidatePath("/", "layout");

export async function createAccountAction(input: unknown): Promise<ActionResult<AccountDTO>> {
  return runAction(async () => {
    const result = await createAccount(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function updateAccountAction(
  id: string,
  input: unknown,
): Promise<ActionResult<AccountDTO>> {
  return runAction(async () => {
    const result = await updateAccount(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export async function reconcileAccountAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ account: AccountDTO; adjustmentMinor: number }>> {
  return runAction(async () => {
    const result = await reconcileAccount(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export async function archiveAccountAction(
  id: string,
  input: unknown,
): Promise<ActionResult<AccountDTO>> {
  return runAction(async () => {
    const result = await archiveAccount(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export async function unarchiveAccountAction(id: string): Promise<ActionResult<AccountDTO>> {
  return runAction(async () => {
    const result = await unarchiveAccount(await requireUser(), id);
    refresh();
    return result;
  });
}
