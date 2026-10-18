import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { DebtDetailContent } from "@/modules/debts/components/debts-content";

export const metadata: Metadata = { title: "Loan" };

export default function DebtPage({ params }: PageProps<"/debts/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4" aria-busy="true" aria-label="Loading loan">
          <Skeleton className="h-9 w-64" />
          <div className="grid gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      }
    >
      <DebtDetailContent params={params} />
    </Suspense>
  );
}
