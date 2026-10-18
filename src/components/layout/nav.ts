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

/** Bottom navigation on mobile (the rest is reachable via "More"). */
export const MOBILE_NAV_HREFS = ["/dashboard", "/transactions", "/assets", "/sip"] as const;

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
