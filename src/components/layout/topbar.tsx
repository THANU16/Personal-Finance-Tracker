import { Suspense } from "react";
import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { HideAmountsToggle } from "@/components/shared/hide-amounts";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { UserArea } from "@/components/layout/user-area";
import { QuickAddButton } from "@/modules/transactions/components/quick-add-context";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
      <Separator orientation="vertical" className="mx-1 hidden h-5 md:block" />
      <div className="relative hidden max-w-sm flex-1 sm:block">
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
        <QuickAddButton label="Add" className="mr-1" />
        <HideAmountsToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          title="Notifications"
          render={<Link href="/notifications" />}
        >
          <Bell aria-hidden />
        </Button>
        <ThemeToggle />
        <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
          <UserArea />
        </Suspense>
      </div>
    </header>
  );
}
