import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreContent } from "@/components/layout/more-content";

export const metadata: Metadata = { title: "More" };

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <Suspense
        fallback={
          <div className="grid gap-6" aria-busy="true" aria-label="Loading">
            {[1, 3, 3, 2, 2].map((rows, i) => (
              <Skeleton key={i} className="rounded-xl" style={{ height: rows * 48 }} />
            ))}
          </div>
        }
      >
        <MoreContent />
      </Suspense>
    </>
  );
}
