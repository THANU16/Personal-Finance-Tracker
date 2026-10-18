import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { OpportunityContent } from "@/modules/opportunity-fund/components/opportunity-content";

export const metadata: Metadata = { title: "Opportunity Fund" };

export default function OpportunityFundPage() {
  return (
    <>
      <PageHeader
        title="Opportunity Fund"
        description="Cash set aside for market drops: track the benchmark, follow your rules and deploy in one step."
      />
      <Suspense
        fallback={
          <div className="space-y-4" aria-busy="true" aria-label="Loading opportunity fund">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-96 rounded-xl" />
          </div>
        }
      >
        <OpportunityContent />
      </Suspense>
    </>
  );
}
