import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TargetPlanContent } from "@/modules/allocation/components/target-plan-content";

export const metadata: Metadata = { title: "Allocation" };

// docs/05 §7 — Plan tab now (the target is needed by SIP plans); drift and rebalancing in Phase 6.
export default function RebalancingPage() {
  return (
    <>
      <PageHeader
        title="Allocation"
        description="Your target allocation. Drift and rebalancing suggestions arrive in Phase 6."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <TargetPlanContent />
      </Suspense>
    </>
  );
}
