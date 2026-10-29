import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AllocationCard,
  AssetsLiabilitiesCard,
  AttentionCard,
  CashCard,
  CashflowCard,
  EssentialsCard,
  DashboardRangeBar,
  GoalsCard,
  NeedsAttentionCard,
  OpportunityCard,
  NetWorthCard,
  StandingCards,
  TopCategoriesCard,
  UpcomingCard,
} from "@/modules/dashboard/components/widgets";

export const metadata: Metadata = { title: "Dashboard" };

const box = (h: string) => <Skeleton className={`${h} rounded-xl`} />;

/**
 * Phone order (docs/07 §5 Home). Below md each widget is its own grid item placed by `order`;
 * from md up the wrapper is `display: contents`, so the desktop grid is exactly as before.
 */
function Slot({ order, children }: { order: string; children: ReactNode }) {
  return <div className={`${order} min-w-0 md:contents`}>{children}</div>;
}

/** Desktop row of widgets; below md its children join the page grid (`contents`). */
const ROW = "contents gap-4 md:grid";

// docs/05 §2. The shell is static; every widget streams behind its own Suspense boundary.
export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <>
      <PageHeader title="Dashboard" description="Where you stand, and how it is changing." />
      <Suspense fallback={<Skeleton className="mb-4 h-9 w-full max-w-3xl" />}>
        <DashboardRangeBar searchParams={searchParams} />
      </Suspense>
      <div className="grid gap-4">
        <Slot order="order-1">
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
        </Slot>
        <div className="order-2 min-w-0 md:hidden">
          <Suspense fallback={box("h-48")}>
            <NeedsAttentionCard searchParams={searchParams} />
          </Suspense>
        </div>
        <Slot order="order-3">
          <Suspense fallback={box("h-36")}>
            <CashCard searchParams={searchParams} />
          </Suspense>
        </Slot>
        <div className={`${ROW} lg:grid-cols-[3fr_2fr]`}>
          <Slot order="order-9">
            <Suspense fallback={box("h-80")}>
              <NetWorthCard searchParams={searchParams} />
            </Suspense>
          </Slot>
          <Slot order="order-5">
            <Suspense fallback={box("h-80")}>
              <AllocationCard searchParams={searchParams} />
            </Suspense>
          </Slot>
        </div>
        <div className={`${ROW} lg:grid-cols-[3fr_2fr]`}>
          <Slot order="order-4">
            <Suspense fallback={box("h-96")}>
              <CashflowCard searchParams={searchParams} />
            </Suspense>
          </Slot>
          <Slot order="order-10">
            <Suspense fallback={box("h-96")}>
              <TopCategoriesCard searchParams={searchParams} />
            </Suspense>
          </Slot>
        </div>
        <Slot order="order-11">
          <Suspense fallback={box("h-80")}>
            <AssetsLiabilitiesCard searchParams={searchParams} />
          </Suspense>
        </Slot>
        {/* Phones show these two merged as "Needs attention" (order-2). */}
        <div className="hidden gap-4 md:grid lg:grid-cols-2">
          <Suspense fallback={box("h-48")}>
            <UpcomingCard searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={box("h-48")}>
            <AttentionCard searchParams={searchParams} />
          </Suspense>
        </div>
        <div className={`${ROW} md:grid-cols-3`}>
          <Slot order="order-6">
            <Suspense fallback={box("h-48")}>
              <GoalsCard searchParams={searchParams} />
            </Suspense>
          </Slot>
          <Slot order="order-7">
            <Suspense fallback={box("h-48")}>
              <EssentialsCard searchParams={searchParams} />
            </Suspense>
          </Slot>
          <Slot order="order-8">
            <Suspense fallback={box("h-48")}>
              <OpportunityCard searchParams={searchParams} />
            </Suspense>
          </Slot>
        </div>
      </div>
    </>
  );
}
