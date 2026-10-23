"use server";

import { revalidatePath } from "next/cache";
import type { TemplateDTO } from "@/modules/recurring/schemas";
import { utcToBusinessDate } from "@/domain/dates";
import type { AccountType } from "@/domain/accounts";
import { listAccounts } from "@/modules/accounts/service";
import type { CategoryNode } from "@/modules/categories/schemas";
import { getCategoryTree } from "@/modules/categories/service";
import { listHoldingOptions, type HoldingOption } from "@/modules/holdings/queries";
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
    /** Can carry emergency / opportunity earmarks (bucket tags on transactions). */
    bucketable: boolean;
    emergencyMinor: number;
    opportunityMinor: number;
  }[];
  categories: CategoryNode[];
  holdings: HoldingOption[];
  tags: string[];
  /** Recurring rules usable as templates (Phase 9). */
  templates: TemplateDTO[];
}

/** Everything the Quick add sheet needs, fetched when it opens (the shell itself is static). */
export async function getQuickAddOptionsAction(): Promise<ActionResult<QuickAddOptions>> {
  return runAction(async () => {
    const ctx = await requireUser();
    const { listTemplates } = await import("@/modules/recurring/service");
    const { listAccountBuckets } = await import("@/modules/earmarks/service");
    const [accounts, categories, tags, holdings, templates, buckets] = await Promise.all([
      listAccounts(ctx),
      getCategoryTree(ctx),
      listTags(ctx),
      listHoldingOptions(ctx),
      listTemplates(ctx),
      listAccountBuckets(ctx),
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
        bucketable: Boolean(buckets.get(a.id)?.canCarryEarmarks),
        emergencyMinor: buckets.get(a.id)?.emergencyMinor ?? 0,
        opportunityMinor: buckets.get(a.id)?.opportunityMinor ?? 0,
      })),
      categories,
      holdings,
      tags,
      templates,
    };
  });
}
