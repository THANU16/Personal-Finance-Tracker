"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, ChartPie, House, Menu, Plus, type LucideIcon } from "lucide-react";
import { mobileTabFor, type MobileTab } from "@/components/layout/nav";
import { useQuickAdd } from "@/modules/transactions/components/quick-add-context";
import { cn } from "@/lib/utils";

// docs/07 §1 — fixed tab bar below md: Home · Activity · + (Quick add) · Invest · More.

interface Tab {
  tab: MobileTab;
  href: string;
  label: string;
  icon: LucideIcon;
}

const LEFT: Tab[] = [
  { tab: "home", href: "/dashboard", label: "Home", icon: House },
  { tab: "activity", href: "/transactions", label: "Activity", icon: ArrowLeftRight },
];
const RIGHT: Tab[] = [
  { tab: "invest", href: "/assets", label: "Invest", icon: ChartPie },
  { tab: "more", href: "/more", label: "More", icon: Menu },
];

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <li>
      <Link
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-14 flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
          active && "font-medium text-foreground",
        )}
      >
        <tab.icon className="size-6" aria-hidden />
        {tab.label}
      </Link>
    </li>
  );
}

function Tabs({ pathname }: { pathname: string | null }) {
  const { open } = useQuickAdd();
  const current = pathname === null ? null : mobileTabFor(pathname);
  return (
    <ul className="grid grid-cols-5 items-end">
      {LEFT.map((t) => (
        <TabLink key={t.tab} tab={t} active={current === t.tab} />
      ))}
      <li className="flex justify-center">
        <button
          type="button"
          onClick={() => open()}
          aria-label="Quick add"
          className="-mt-5 mb-1 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform active:scale-95"
        >
          <Plus className="size-7" aria-hidden />
        </button>
      </li>
      {RIGHT.map((t) => (
        <TabLink key={t.tab} tab={t} active={current === t.tab} />
      ))}
    </ul>
  );
}

function ActiveTabs() {
  return <Tabs pathname={usePathname()} />;
}

export function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden"
    >
      {/* The pathname is request data: the static shell renders the bar without a highlight */}
      <Suspense fallback={<Tabs pathname={null} />}>
        <ActiveTabs />
      </Suspense>
    </nav>
  );
}
