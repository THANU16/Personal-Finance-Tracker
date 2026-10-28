import { Suspense } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { HideAmountsToggle } from "@/components/shared/hide-amounts";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { MobileTopbarNav } from "@/components/layout/mobile-topbar-nav";
import { UserArea } from "@/components/layout/user-area";
import {
  NotificationBell,
  NotificationBellFallback,
} from "@/modules/notifications/components/notification-bell";
import { QuickAddButton } from "@/modules/transactions/components/quick-add-context";

// Below md (docs/07 §1) the bar is compact: back chevron + collapsing title on the left, only
// hide-amounts and notifications on the right (Add is the tab bar's +, theme and account live on
// the More page). From md up it is the desktop bar, unchanged.
const ICON_44 = "relative size-11 md:size-8";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="relative flex h-14 items-center gap-2 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:pr-4 md:pl-4">
        <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
        <Separator orientation="vertical" className="mx-1 hidden h-5 md:block" />
        <MobileTopbarNav />
        <div className="relative hidden max-w-sm flex-1 md:block">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          {/* Global search arrives with transactions and holdings (Phase 2+) */}
          <Input
            type="search"
            placeholder="Search (coming soon)"
            aria-label="Search"
            disabled
            className="pl-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <QuickAddButton label="Add" className="mr-1 hidden md:inline-flex" />
          <HideAmountsToggle className={ICON_44} />
          <Suspense fallback={<NotificationBellFallback className={ICON_44} />}>
            <NotificationBell className={ICON_44} />
          </Suspense>
          <div className="hidden md:contents">
            <ThemeToggle />
          </div>
          {/* Stays mounted on phones: UserArea also syncs the hide-amounts setting */}
          <div className="hidden md:contents">
            <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
              <UserArea />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}
