import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AllocationCard,
  AssetsLiabilitiesCard,
  AttentionCard,
  CashCard,
  CashflowCard,
  DashboardRangeBar,
  LaterCard,
  NetWorthCard,
  StandingCards,
  TopCategoriesCard,
  UpcomingCard,
} from "@/modules/dashboard/components/widgets";

export const metadata: Metadata = { title: "Dashboard" };

const box = (h: string) => <Skeleton className={`${h} rounded-xl`} />;

// docs/05 §2. The shell is static; every widget streams behind its own Suspense boundary.
export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <>
      <PageHeader title="Dashboard" description="Where you stand, and how it is changing." />
      <Suspense fallback={<Skeleton className="mb-4 h-9 w-full max-w-3xl" />}>
        <DashboardRangeBar searchParams={searchParams} />
      </Suspense>
      <div className="grid gap-4">
        <Suspense
          fallback={
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          }
        >
          <StandingCards searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={box("h-36")}>
          <CashCard searchParams={searchParams} />
        </Suspense>
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Suspense fallback={box("h-80")}>
            <NetWorthCard searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={box("h-80")}>
            <AllocationCard searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Suspense fallback={box("h-96")}>
            <CashflowCard searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={box("h-96")}>
            <TopCategoriesCard searchParams={searchParams} />
          </Suspense>
        </div>
        <Suspense fallback={box("h-80")}>
          <AssetsLiabilitiesCard searchParams={searchParams} />
        </Suspense>
        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense fallback={box("h-48")}>
            <UpcomingCard searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={box("h-48")}>
            <AttentionCard searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <LaterCard title="Goals" phase={9} text="Goal progress bars arrive with goals" />
          <LaterCard
            title="Essentials"
            phase={10}
            text="Emergency months and health score arrive with Essentials"
          />
          <LaterCard
            title="Opportunity fund"
            phase={7}
            text="Fund size vs target and drawdown arrive with the Opportunity Fund"
          />
        </div>
      </div>
    </>
  );
}
