"use server";

import { revalidatePath } from "next/cache";
import { utcToBusinessDate } from "@/domain/dates";
import type { AccountType } from "@/domain/accounts";
import { listAccounts } from "@/modules/accounts/service";
import type { CategoryNode } from "@/modules/categories/schemas";
import { getCategoryTree } from "@/modules/categories/service";
import { listTags } from "@/modules/transactions/queries";
import {
  createTransaction,
  updateTransaction,
  voidTransaction,
} from "@/modules/transactions/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

const refresh = () => revalidatePath("/", "layout");

export async function createTransactionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const result = await createTransaction(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function updateTransactionAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const result = await updateTransaction(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export async function voidTransactionAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const result = await voidTransaction(await requireUser(), id, input);
    refresh();
    return result;
  });
}

export interface QuickAddOptions {
  todayKey: string;
  baseCurrency: string;
  accounts: {
    id: string;
    name: string;
    type: AccountType;
    currency: string;
    balanceMinor: number;
  }[];
  categories: CategoryNode[];
  tags: string[];
}

/** Everything the Quick add sheet needs, fetched when it opens (the shell itself is static). */
export async function getQuickAddOptionsAction(): Promise<ActionResult<QuickAddOptions>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const [accounts, categories, tags] = await Promise.all([
      listAccounts(ctx),
      getCategoryTree(ctx),
      listTags(ctx),
    ]);
    return {
      todayKey: utcToBusinessDate(new Date(), ctx.tz),
      baseCurrency: ctx.baseCurrency,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balanceMinor: a.balanceMinor,
      })),
      categories,
      tags,
    };
  });
}
