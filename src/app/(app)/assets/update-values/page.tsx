import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { UpdateValuesForm } from "@/modules/holdings/components/update-values-form";
import { getValueUpdateRows } from "@/modules/holdings/queries";
import { getCurrentUser } from "@/server/auth/require-user";

export const metadata: Metadata = { title: "Update values" };

async function Content() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { rows, bigChangeThresholdBp, today } = await getValueUpdateRows(current.ctx);
  if (!rows.length) {
    return (
      <EmptyState
        icon={<RefreshCw />}
        title="Nothing to update"
        description="Market-valued holdings appear here. Fixed deposits are calculated automatically."
      />
    );
  }
  return <UpdateValuesForm rows={rows} bigChangeThresholdBp={bigChangeThresholdBp} today={today} />;
}

export default function UpdateValuesPage() {
  return (
    <>
      <Link
        href="/assets"
        // Phones go back with the top bar's chevron (docs/07 §1).
        className="mb-3 hidden items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:inline-flex"
      >
        <ArrowLeft className="size-4" aria-hidden /> Assets
      </Link>
      <PageHeader
        title="Update values"
        description="Enter today's values (or NAVs) and save them together."
      />
      <Suspense
        fallback={
          <Skeleton className="h-96 rounded-xl" aria-busy="true" aria-label="Loading holdings" />
        }
      >
        <Content />
      </Suspense>
    </>
  );
}
