"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { ALL_NAV_ITEMS, MOBILE_NAV_HREFS, isActive } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

const ITEMS = MOBILE_NAV_HREFS.map((href) => ALL_NAV_ITEMS.find((i) => i.href === href)!);

function Items({ pathname }: { pathname: string | null }) {
  return ITEMS.map((item) => {
    const active = pathname !== null && isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground",
            active && "text-foreground",
          )}
        >
          <item.icon className="size-5" aria-hidden />
          {item.title === "SIP Planner" ? "SIP" : item.title}
        </Link>
      </li>
    );
  });
}

function ActiveItems() {
  return <Items pathname={usePathname()} />;
}

export function MobileBottomNav() {
  const { setOpenMobile } = useSidebar();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        <Suspense fallback={<Items pathname={null} />}>
          <ActiveItems />
        </Suspense>
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className="flex w-full flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground"
          >
            <Menu className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
