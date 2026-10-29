import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getDebtForAccount } from "@/modules/debts/service";
import { requireUser } from "@/server/auth/require-user";

export const metadata: Metadata = { title: "Loan" };

/** Quick add "Debt pay" (docs/07 §5): from a loan account to its loan, Record payment open. */
async function ToLoan({ params }: { params: Promise<{ accountId: string }> }): Promise<ReactNode> {
  const [{ accountId }, ctx] = await Promise.all([params, requireUser()]);
  const debt = await getDebtForAccount(ctx, accountId).catch(() => null);
  if (!debt) notFound();
  return redirect(`/debts/${debt.id}?pay=1`);
}

export default function DebtByAccountPage({ params }: PageProps<"/debts/by-account/[accountId]">) {
  return (
    <Suspense fallback={<Skeleton className="h-64 rounded-xl" aria-label="Opening the loan" />}>
      <ToLoan params={params} />
    </Suspense>
  );
}
