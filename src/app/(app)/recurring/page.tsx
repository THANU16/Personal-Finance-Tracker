import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { RecurringContent } from "@/modules/recurring/components/recurring-content";

export const metadata: Metadata = { title: "Recurring" };

export default function RecurringPage() {
  return (
    <>
      <PageHeader
        title="Recurring"
        description="Salary, rent, bills and EMIs as templates. Confirm each one when it happens; nothing posts on its own."
      />
      <Suspense
        fallback={
          <Skeleton
            className="h-80 rounded-xl"
            aria-busy="true"
            aria-label="Loading recurring rules"
          />
        }
      >
        <RecurringContent />
      </Suspense>
    </>
  );
}
