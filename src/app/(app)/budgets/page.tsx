import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { BudgetsContent } from "@/modules/budgets/components/budgets-content";

export const metadata: Metadata = { title: "Budgets" };

export default function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  return (
    <>
      <PageHeader
        title="Budgets"
        description="A monthly limit per expense category, with what is left and what is not budgeted."
      />
      <Suspense
        fallback={
          <Skeleton className="h-96 rounded-xl" aria-busy="true" aria-label="Loading budgets" />
        }
      >
        <BudgetsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
