import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EssentialsContent } from "@/modules/essentials/components/essentials-content";

export const metadata: Metadata = { title: "Essentials" };

export default function EssentialsPage() {
  return (
    <>
      <PageHeader
        title="Essentials"
        description="Emergency fund, insurance, debt load and savings — combined into a health score."
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading essentials">
            <Skeleton className="h-56 rounded-xl" />
            <div className="grid gap-4 xl:grid-cols-2">
              <Skeleton className="h-80 rounded-xl" />
              <Skeleton className="h-80 rounded-xl" />
            </div>
          </div>
        }
      >
        <EssentialsContent />
      </Suspense>
    </>
  );
}
