import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { GoalsContent } from "@/modules/goals/components/goals-content";

export const metadata: Metadata = { title: "Goals" };

export default function GoalsPage() {
  return (
    <>
      <PageHeader
        title="Goals"
        description="Targets funded by your savings and investments, and what each needs a month."
      />
      <Suspense
        fallback={
          <div
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            aria-busy="true"
            aria-label="Loading goals"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        }
      >
        <GoalsContent />
      </Suspense>
    </>
  );
}
