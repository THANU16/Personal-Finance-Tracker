import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { Topbar } from "@/components/layout/topbar";
import { QuickAddProvider } from "@/modules/transactions/components/quick-add-context";

// The shell is static; only the user menu (inside Topbar) reads the session, behind <Suspense>.
// Quick add (button + N key) is global; the notifications count arrives in Phase 10.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <QuickAddProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Topbar />
          <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-24 md:px-6 md:pb-8">
            {children}
          </div>
        </SidebarInset>
        <MobileBottomNav />
      </SidebarProvider>
    </QuickAddProvider>
  );
}
