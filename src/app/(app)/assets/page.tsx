import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { AddHoldingAction, PortfolioView } from "@/modules/holdings/components/portfolio-view";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage({ searchParams }: PageProps<"/assets">) {
  return (
    <>
      <PageHeader
        title="Assets"
        description="Every investment with invested, value, gains and XIRR."
        actions={
          <>
            <Button variant="outline" render={<Link href="/assets/import-valuations" />}>
              Import history
            </Button>
            <Button variant="outline" render={<Link href="/assets/update-values" />}>
              <RefreshCw aria-hidden /> Update values
            </Button>
            <Suspense fallback={<Button disabled>Add holding</Button>}>
              <AddHoldingAction />
            </Suspense>
          </>
        }
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading assets">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-xl" />
          </div>
        }
      >
        <PortfolioView searchParams={searchParams} />
      </Suspense>
    </>
  );
}
