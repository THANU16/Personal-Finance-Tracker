import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { QuickAddButton } from "@/modules/transactions/components/quick-add-context";
import { TransactionsContent } from "@/modules/transactions/components/transactions-content";

export const metadata: Metadata = { title: "Transactions" };

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every income, expense and transfer — the ledger behind all your balances."
        actions={<QuickAddButton label="Add transaction" />}
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading transactions">
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        }
      >
        <TransactionsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
