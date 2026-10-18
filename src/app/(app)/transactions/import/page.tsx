import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportPageContent } from "@/modules/imports/components/import-page-content";

export const metadata: Metadata = { title: "Import transactions" };

export default function ImportTransactionsPage() {
  return (
    <>
      <PageHeader
        title="Import transactions"
        description="Bring history from another app. Nothing is saved until you confirm the preview."
      />
      <Suspense
        fallback={
          <div className="grid gap-6 lg:grid-cols-2" aria-busy="true" aria-label="Loading imports">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        }
      >
        <ImportPageContent />
      </Suspense>
    </>
  );
}
