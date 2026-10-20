import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingContent } from "@/modules/settings/components/onboarding-content";

export const metadata: Metadata = { title: "Welcome" };

// docs/05 §18 — first-login setup.
export default function OnboardingPage() {
  return (
    <>
      <PageHeader
        title="Welcome to WealthTrack"
        description="A few steps to get your money in. Skip any of them — everything can be added later."
      />
      <Suspense fallback={<Skeleton className="mx-auto h-72 max-w-2xl rounded-xl" />}>
        <OnboardingContent />
      </Suspense>
    </>
  );
}
