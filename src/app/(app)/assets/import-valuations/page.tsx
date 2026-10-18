import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ValuationImportClient } from "@/modules/imports/components/valuation-import-client";

export const metadata: Metadata = { title: "Import valuation history" };

async function Content({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const holding =
    typeof sp.holding === "string" && /^[a-f0-9]{24}$/i.test(sp.holding) ? sp.holding : null;
  return <ValuationImportClient holdingId={holding} />;
}

export default function ImportValuationsPage({
  searchParams,
}: PageProps<"/assets/import-valuations">) {
  return (
    <>
      <PageHeader
        title="Import valuation history"
        description="Bring a holding's past values from a CSV, mark which jumps were deposits or withdrawals, then import in one step."
      />
      <Suspense
        fallback={
          <Skeleton className="h-64 rounded-xl" aria-busy="true" aria-label="Loading import" />
        }
      >
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
