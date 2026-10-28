"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_GROUPS, isActive } from "@/components/layout/nav";

function NavGroups({ pathname }: { pathname: string | null }) {
  const { setOpenMobile } = useSidebar();
  return NAV_GROUPS.map((group) => (
    <SidebarGroup key={group.title}>
      <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => {
            const active = pathname !== null && isActive(pathname, item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={item.title}
                  render={
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    />
                  }
                >
                  <item.icon aria-hidden />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}

function ActiveNavGroups() {
  return <NavGroups pathname={usePathname()} />;
}

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  // Phones navigate with the tab bar and the More page (docs/07 §1), never this drawer.
  if (isMobile) return null;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="WealthTrack"
              render={<Link href="/dashboard" onClick={() => setOpenMobile(false)} />}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wallet className="size-4" aria-hidden />
              </span>
              <span className="font-semibold">WealthTrack</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* The pathname is request data: the static shell renders the nav without highlight */}
        <Suspense fallback={<NavGroups pathname={null} />}>
          <ActiveNavGroups />
        </Suspense>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
