import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { utcToBusinessDate } from "@/domain/dates";
import { cn } from "@/lib/utils";
import { getPortfolio } from "@/modules/holdings/queries";
import {
  CategoriesView,
  IncomeExpenseView,
  IncomeView,
  MonthlyView,
  NetWorthView,
  PerformanceView,
  PeriodPicker,
  RealisedView,
} from "@/modules/reports/components/reports-views";
import { REPORTS, type ReportKey } from "@/modules/reports/csv";
import {
  getCategoriesReport,
  getIncomeExpense,
  getInvestmentIncome,
  getMonthlySummary,
  getNetWorthHistory,
  getRealisedGains,
  parseMonth,
  parseYear,
  shiftMonth,
} from "@/modules/reports/service";
import { requireUser } from "@/server/auth/require-user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const LABELS: Record<ReportKey, string> = {
  monthly: "Monthly summary",
  "income-expense": "Income vs expense",
  categories: "Categories",
  performance: "Investment performance",
  realised: "Realised gains",
  income: "Investment income & tax",
  "net-worth": "Net worth history",
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** docs/05 §15 — one tab at a time (only its data is loaded); every tab exports CSV. */
export async function ReportsContent({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const tab: ReportKey = (REPORTS as readonly string[]).includes(one(sp.tab) ?? "")
    ? (one(sp.tab) as ReportKey)
    : "monthly";
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const thisMonth = today.slice(0, 7);
  const thisYear = Number(today.slice(0, 4));
  const params: Record<string, string> = {};
  let body: React.ReactNode;
  let picker: React.ReactNode = null;

  switch (tab) {
    case "monthly": {
      const month = parseMonth(one(sp.month), shiftMonth(thisMonth, -1));
      params.month = month;
      const s = await getMonthlySummary(ctx, month);
      picker = (
        <PeriodPicker
          tab={tab}
          name="month"
          value={month}
          options={s.months.map((m) => ({ value: m, label: m }))}
        />
      );
      body = <MonthlyView data={s} />;
      break;
    }
    case "income-expense":
      body = <IncomeExpenseView data={await getIncomeExpense(ctx)} />;
      break;
    case "categories": {
      const from = parseMonth(one(sp.from), thisMonth);
      const to = parseMonth(one(sp.to), from);
      params.from = from;
      params.to = to;
      const months = Array.from({ length: 36 }, (_, i) => shiftMonth(thisMonth, -i)).map((m) => ({
        value: m,
        label: m,
      }));
      picker = (
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            tab={tab}
            name="from"
            value={from}
            options={months}
            keep={{ to }}
            label="From"
          />
          <PeriodPicker
            tab={tab}
            name="to"
            value={to}
            options={months}
            keep={{ from }}
            label="To"
          />
        </div>
      );
      body = <CategoriesView data={await getCategoriesReport(ctx, from, to)} />;
      break;
    }
    case "performance":
      body = <PerformanceView data={await getPortfolio(ctx, { includeClosed: true })} />;
      break;
    case "realised":
    case "income": {
      const year = parseYear(one(sp.year), thisYear);
      params.year = String(year);
      const years = Array.from({ length: 10 }, (_, i) => String(thisYear - i)).map((y) => ({
        value: y,
        label: y,
      }));
      picker = (
        <PeriodPicker tab={tab} name="year" value={String(year)} options={years} label="Year" />
      );
      body =
        tab === "realised" ? (
          <RealisedView data={await getRealisedGains(ctx, year)} />
        ) : (
          <IncomeView data={await getInvestmentIncome(ctx, year)} />
        );
      break;
    }
    case "net-worth":
      body = <NetWorthView data={await getNetWorthHistory(ctx)} />;
      break;
  }

  const exportHref = `/api/export?${new URLSearchParams({ kind: "report", report: tab, ...params })}`;
  return (
    <div className="grid gap-4">
      <nav
        aria-label="Reports"
        className="flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-0.5 text-sm"
      >
        {REPORTS.map((key) => (
          <Link
            key={key}
            href={key === "monthly" ? "/reports" : `/reports?tab=${key}`}
            aria-current={key === tab ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1",
              key === tab
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABELS[key]}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{LABELS[tab]}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {picker}
          <Button variant="outline" size="sm" render={<a href={exportHref} download />}>
            <Download aria-hidden /> Export CSV
          </Button>
        </div>
      </div>
      {body}
    </div>
  );
}
