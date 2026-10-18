import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DebtsContent } from "@/modules/debts/components/debts-content";

export const metadata: Metadata = { title: "Debts" };

export default function DebtsPage() {
  return (
    <>
      <PageHeader
        title="Debts"
        description="Loans with their EMI, schedule and payoff date, plus money lent and owed."
      />
      <Suspense
        fallback={
          <div className="space-y-4" aria-busy="true" aria-label="Loading debts">
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-xl" />
          </div>
        }
      >
        <DebtsContent />
      </Suspense>
    </>
  );
}
