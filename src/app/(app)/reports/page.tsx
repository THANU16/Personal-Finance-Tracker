import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportsContent } from "@/modules/reports/components/reports-content";

export const metadata: Metadata = { title: "Reports" };

// docs/05 §15 — seven report tabs, each with Export CSV; Monthly summary = the monthly review.
export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Monthly review, cashflow, categories and investment results — each exportable as CSV."
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading report">
            <Skeleton className="h-9 w-full max-w-3xl rounded-lg" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        }
      >
        <ReportsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
