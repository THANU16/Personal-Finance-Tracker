import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SipContent } from "@/modules/sip/components/sip-content";

export const metadata: Metadata = { title: "SIP planner" };

export default function SipPage({ searchParams }: PageProps<"/sip">) {
  return (
    <>
      <PageHeader
        title="SIP planner"
        description="Regular investments: plan, execute, and see how consistent you are."
        actions={
          <Button render={<Link href="/sip/plans/new" />}>
            <Plus aria-hidden /> New plan
          </Button>
        }
      />
      <Suspense fallback={<Skeleton className="h-72 rounded-xl" />}>
        <SipContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
