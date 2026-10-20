import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ForecastContent } from "@/modules/forecast/components/forecast-content";

export const metadata: Metadata = { title: "Forecast" };

// docs/05 §14 — cashflow forecast; plus the net worth projection and insights (docs/04 §22).
export default function ForecastPage({ searchParams }: PageProps<"/forecast">) {
  return (
    <>
      <PageHeader
        title="Forecast"
        description="Where your cash accounts are heading with the bills, SIPs and EMIs already planned."
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading forecast">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        }
      >
        <ForecastContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
