import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import {
  AccountsOverview,
  AddAccountAction,
} from "@/modules/accounts/components/accounts-overview";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Cash, bank, cards, loans and money owed — balances come from your transactions."
        actions={
          <Suspense fallback={<Button disabled>Add account</Button>}>
            <AddAccountAction />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading accounts">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        }
      >
        <AccountsOverview searchParams={searchParams} />
      </Suspense>
    </>
  );
}
