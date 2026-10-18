import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanEditorContent } from "@/modules/sip/components/sip-pages";

export const metadata: Metadata = { title: "New SIP plan" };

export default function NewSipPlanPage() {
  return (
    <>
      <PageHeader title="New SIP plan" description="A regular investment from one account." />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <PlanEditorContent />
      </Suspense>
    </>
  );
}
