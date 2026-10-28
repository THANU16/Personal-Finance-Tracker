import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  ChartColumn,
  ChartLine,
  ChartPie,
  CreditCard,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Repeat,
  Scale,
  Settings,
  ShieldCheck,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// docs/05-UI-SPEC.md §1 — sidebar groups
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Forecast", href: "/forecast", icon: ChartLine },
      { title: "Reports", href: "/reports", icon: ChartColumn },
    ],
  },
  {
    title: "Money",
    items: [
      { title: "Accounts", href: "/accounts", icon: Landmark },
      { title: "Transactions", href: "/transactions", icon: ArrowLeftRight },
      { title: "Recurring", href: "/recurring", icon: Repeat },
      { title: "Budgets", href: "/budgets", icon: PiggyBank },
    ],
  },
  {
    title: "Invest",
    items: [
      { title: "Assets", href: "/assets", icon: ChartPie },
      { title: "SIP Planner", href: "/sip", icon: CalendarClock },
      { title: "Allocation", href: "/rebalancing", icon: Scale },
      { title: "Opportunity Fund", href: "/opportunity-fund", icon: Zap },
    ],
  },
  {
    title: "Plan",
    items: [
      { title: "Goals", href: "/goals", icon: Target },
      { title: "Debts", href: "/debts", icon: CreditCard },
      { title: "Essentials", href: "/essentials", icon: ShieldCheck },
    ],
  },
  {
    title: "System",
    items: [
      { title: "Notifications", href: "/notifications", icon: Bell },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const item = (href: string): NavItem => {
  const found = ALL_NAV_ITEMS.find((i) => i.href === href);
  if (!found) throw new Error(`No nav item for ${href}`);
  return found;
};

// docs/07 §1 — mobile shell (< md): tab bar, Invest hub, More page.

/** Invest hub segments (segmented control on these four pages). */
export const INVEST_HUB: NavItem[] = [
  { ...item("/assets"), title: "Assets" },
  { ...item("/sip"), title: "SIP" },
  { ...item("/rebalancing"), title: "Allocation" },
  { ...item("/opportunity-fund"), title: "Opp. Fund" },
];

/** More page groups (iOS settings style). */
export const MORE_GROUPS: NavGroup[] = [
  { title: "Money", items: [item("/accounts"), item("/recurring"), item("/budgets")] },
  { title: "Plan", items: [item("/goals"), item("/debts"), item("/essentials")] },
  { title: "Insights", items: [item("/forecast"), item("/reports")] },
  { title: "System", items: [item("/notifications"), item("/settings")] },
];

export type MobileTab = "home" | "activity" | "invest" | "more";

const MORE_HREFS = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.href));

/** Which tab-bar tab a page belongs to (null: none, e.g. onboarding). */
export function mobileTabFor(pathname: string): MobileTab | null {
  if (isActive(pathname, "/dashboard")) return "home";
  if (isActive(pathname, "/transactions")) return "activity";
  if (INVEST_HUB.some((i) => isActive(pathname, i.href))) return "invest";
  if (pathname === "/more" || MORE_HREFS.some((href) => isActive(pathname, href))) return "more";
  return null;
}

/** True on the four Invest hub pages themselves (not their detail pages). */
export function isInvestHubPage(pathname: string): boolean {
  return INVEST_HUB.some((i) => i.href === pathname);
}

/** Where the mobile top bar's back chevron goes; null on tab roots. */
export function mobileParent(pathname: string): { href: string; label: string } | null {
  if (pathname.startsWith("/transactions/import/")) {
    return { href: "/transactions/import", label: "Import" };
  }
  if (pathname.startsWith("/transactions/")) return { href: "/transactions", label: "Activity" };
  for (const href of ["/accounts", "/assets", "/debts", "/sip"]) {
    if (pathname.startsWith(`${href}/`)) {
      return { href, label: href === "/sip" ? "SIP" : item(href).title };
    }
  }
  if (MORE_HREFS.includes(pathname)) return { href: "/more", label: "More" };
  return null;
}
