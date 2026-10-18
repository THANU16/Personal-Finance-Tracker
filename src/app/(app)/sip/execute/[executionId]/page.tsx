import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecuteContent } from "@/modules/sip/components/sip-pages";

export const metadata: Metadata = { title: "Execute SIP" };

export default function ExecuteSipPage({ params }: PageProps<"/sip/execute/[executionId]">) {
  return (
    <>
      <PageHeader
        title="Execute SIP"
        description="Record what you actually invested this period."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <ExecuteContent params={params} />
      </Suspense>
    </>
  );
}
