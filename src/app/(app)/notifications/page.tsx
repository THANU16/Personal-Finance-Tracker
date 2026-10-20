import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationsContent } from "@/modules/notifications/components/notifications-content";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Reminders and alerts from the daily check: dues, renewals, budgets, goals and forecasts."
      />
      <Suspense
        fallback={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading notifications">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        }
      >
        <NotificationsContent />
      </Suspense>
    </>
  );
}
