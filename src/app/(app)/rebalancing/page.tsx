import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AllocationContent } from "@/modules/rebalancing/components/allocation-content";

export const metadata: Metadata = { title: "Allocation" };

// docs/05 §7 — Plan · Planned vs Actual · Rebalance · History (route stays /rebalancing).
export default function RebalancingPage({ searchParams }: PageProps<"/rebalancing">) {
  return (
    <>
      <PageHeader
        title="Allocation"
        description="Your target allocation, how far you are from it, and how to get back."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <AllocationContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
