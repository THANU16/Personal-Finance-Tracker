import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { InvestHubNav } from "@/components/layout/invest-hub-nav";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { PullToRefresh } from "@/components/layout/pull-to-refresh";
import { Topbar } from "@/components/layout/topbar";
import { QuickAddProvider } from "@/modules/transactions/components/quick-add-context";

// The shell is static; only the user menu (inside Topbar) reads the session, behind <Suspense>.
// Quick add (button + N key) is global; the notifications count arrives in Phase 10.
// Below md (docs/07 §1) the sidebar is replaced by the tab bar, the Invest hub and the More page.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <QuickAddProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Topbar />
          <PullToRefresh />
          <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 md:pb-8">
            <InvestHubNav />
            {children}
          </div>
        </SidebarInset>
        <MobileTabBar />
      </SidebarProvider>
    </QuickAddProvider>
  );
}
