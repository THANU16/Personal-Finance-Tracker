import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { HoldingDetailView } from "@/modules/holdings/components/holding-detail";

export const metadata: Metadata = { title: "Holding" };

export default function HoldingPage({ params }: PageProps<"/assets/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4" aria-busy="true" aria-label="Loading holding">
          <Skeleton className="h-10 w-72" />
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      }
    >
      <HoldingDetailView params={params} />
    </Suspense>
  );
}
