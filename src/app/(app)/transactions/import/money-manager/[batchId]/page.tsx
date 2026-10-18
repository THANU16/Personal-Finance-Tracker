import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WizardContent } from "@/modules/imports/components/wizard-content";

export const metadata: Metadata = { title: "Money Manager import" };

async function Wizard({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <WizardContent batchId={batchId} />;
}

export default function MoneyManagerImportPage({
  params,
}: PageProps<"/transactions/import/money-manager/[batchId]">) {
  return (
    <>
      <PageHeader
        title="Money Manager import"
        description="Map accounts and categories, review special rows, check the preview, then import."
      />
      <Suspense
        fallback={
          <div className="space-y-4" aria-busy="true" aria-label="Loading import">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        }
      >
        <Wizard params={params} />
      </Suspense>
    </>
  );
}
