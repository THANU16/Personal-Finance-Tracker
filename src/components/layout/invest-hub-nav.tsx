"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { INVEST_HUB, isInvestHubPage } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

// docs/07 §1 — Invest hub: one segmented control across Assets, SIP, Allocation and Opp. Fund.
// Phones only; desktop keeps the sidebar.

function HubNav() {
  const pathname = usePathname();
  if (!isInvestHubPage(pathname)) return null;
  return (
    <nav aria-label="Invest" className="-mx-4 mb-4 overflow-x-auto px-4 md:hidden">
      <ul className="flex min-w-full gap-1 rounded-xl bg-muted p-1">
        {INVEST_HUB.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center rounded-lg px-3 text-sm whitespace-nowrap text-muted-foreground",
                  active && "bg-background font-medium text-foreground shadow-sm",
                )}
              >
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function InvestHubNav() {
  return (
    <Suspense fallback={null}>
      <HubNav />
    </Suspense>
  );
}
