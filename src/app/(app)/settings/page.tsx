import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsContent } from "@/modules/settings/components/settings-content";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile, currency, timezone and alert preferences."
      />
      <Suspense
        fallback={
          <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        }
      >
        <SettingsContent />
      </Suspense>
    </>
  );
}
