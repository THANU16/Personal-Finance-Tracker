import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountDetail } from "@/modules/accounts/components/account-detail";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4" aria-busy="true" aria-label="Loading account">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-3 sm:grid-cols-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      }
    >
      <AccountDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}
