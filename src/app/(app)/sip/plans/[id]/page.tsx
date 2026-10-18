import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanEditorContent } from "@/modules/sip/components/sip-pages";

export const metadata: Metadata = { title: "SIP plan" };

export default function SipPlanPage({ params }: PageProps<"/sip/plans/[id]">) {
  return (
    <>
      <PageHeader
        title="SIP plan"
        description="Amount or allocation changes create a new version from the next period."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <PlanEditorContent params={params} />
      </Suspense>
    </>
  );
}
