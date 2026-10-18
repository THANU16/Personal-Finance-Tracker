import { BudgetsClient } from "@/modules/budgets/components/budgets-client";
import { currentMonth, getBudgetMonth } from "@/modules/budgets/service";
import { requireUser } from "@/server/auth/require-user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function BudgetsContent({ searchParams }: { searchParams: SearchParams }) {
  const [ctx, sp] = await Promise.all([requireUser(), searchParams]);
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentMonth(ctx);
  return <BudgetsClient data={await getBudgetMonth(ctx, month)} />;
}
