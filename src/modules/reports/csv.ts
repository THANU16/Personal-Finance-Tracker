import "server-only";
import { bpToCsv, minorToCsv, toCsv } from "@/domain/csv";
import { minorUnitDigits } from "@/domain/money";
import { getPortfolio } from "@/modules/holdings/queries";
import {
  getCategoriesReport,
  getIncomeExpense,
  getInvestmentIncome,
  getMonthlySummary,
  getNetWorthHistory,
  getRealisedGains,
  parseMonth,
  parseYear,
} from "@/modules/reports/service";
import type { Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { utcToBusinessDate } from "@/domain/dates";

// Export CSV for every Reports tab (docs/05 §15). Plain decimals (no locale formatting), base currency.

export const REPORTS = [
  "monthly",
  "income-expense",
  "categories",
  "performance",
  "realised",
  "income",
  "net-worth",
] as const;
export type ReportKey = (typeof REPORTS)[number];

type Params = Record<string, string | undefined>;

export async function reportCsv(
  ctx: Ctx,
  report: string,
  params: Params,
): Promise<{ fileName: string; csv: string }> {
  const today = utcToBusinessDate(new Date(), ctx.tz);
  const m = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : minorToCsv(v, minorUnitDigits(ctx.baseCurrency));
  const ccy = ctx.baseCurrency;
  switch (report as ReportKey) {
    case "monthly": {
      const month = parseMonth(params.month, today.slice(0, 7));
      const { review: r } = await getMonthlySummary(ctx, month);
      const rows: [string, string, string][] = [
        ["Income", m(r.incomeMinor), m(r.previous.incomeMinor)],
        ["Expense", m(r.expenseMinor), m(r.previous.expenseMinor)],
        ["Savings", m(r.savingsMinor), m(r.previous.incomeMinor - r.previous.expenseMinor)],
        ["Savings rate %", bpToCsv(r.savingsRateBp), bpToCsv(r.previous.savingsRateBp)],
        ["Net worth at month end", m(r.netWorth.endMinor), m(r.netWorth.startMinor)],
        ["Net worth change", m(r.netWorth.changeMinor), ""],
        ["Realised gains", m(r.realizedGainMinor), ""],
        ["Fees paid", m(r.feesMinor), ""],
        [
          "SIPs done / partial / missed / skipped",
          `${r.sips.done}/${r.sips.partial}/${r.sips.missed}/${r.sips.skipped}`,
          "",
        ],
        ["SIP amount invested", m(r.sips.investedMinor), ""],
        ...r.incomeCategories.map(
          (c) =>
            [`Income: ${c.name}`, m(c.amountMinor), m(c.previousMinor)] as [string, string, string],
        ),
        ...r.expenseCategories.map(
          (c) =>
            [`Expense: ${c.name}`, m(c.amountMinor), m(c.previousMinor)] as [
              string,
              string,
              string,
            ],
        ),
        ...r.budgets.map(
          (b) =>
            [`Budget: ${b.name} (${b.status})`, m(b.spentMinor), m(b.budgetMinor)] as [
              string,
              string,
              string,
            ],
        ),
      ];
      return {
        fileName: `monthly-summary-${month}.csv`,
        csv: toCsv(rows, [
          { header: "Item", value: (x) => x[0] },
          { header: `${month} (${ccy})`, value: (x) => x[1] },
          { header: "Previous month / budget", value: (x) => x[2] },
        ]),
      };
    }
    case "income-expense": {
      const { points } = await getIncomeExpense(ctx);
      return {
        fileName: `income-vs-expense-${today}.csv`,
        csv: toCsv(points, [
          { header: "Month", value: (p) => p.key.slice(0, 7) },
          { header: `Income (${ccy})`, value: (p) => m(p.incomeMinor) },
          { header: `Expense (${ccy})`, value: (p) => m(p.expenseMinor) },
          { header: `Savings (${ccy})`, value: (p) => m(p.savingsMinor) },
          { header: "Savings rate %", value: (p) => bpToCsv(p.savingsRateBp) },
        ]),
      };
    }
    case "categories": {
      const month = today.slice(0, 7);
      const r = await getCategoriesReport(
        ctx,
        parseMonth(params.from, month),
        parseMonth(params.to, month),
      );
      const flat = r.rows.flatMap((row) => [
        {
          name: row.name,
          parent: "",
          amount: row.amountMinor,
          previous: row.previousMinor,
          change: row.changeBp,
          share: row.shareBp,
        },
        ...row.children.map((c) => ({
          name: c.name,
          parent: row.name,
          amount: c.amountMinor,
          previous: null,
          change: null,
          share: null,
        })),
      ]);
      return {
        fileName: `categories-${r.from}-to-${r.to}.csv`,
        csv: toCsv(flat, [
          { header: "Category", value: (x) => x.name },
          { header: "Parent", value: (x) => x.parent },
          { header: `Spent (${ccy})`, value: (x) => m(x.amount) },
          { header: `Previous period (${ccy})`, value: (x) => m(x.previous) },
          { header: "Change %", value: (x) => bpToCsv(x.change) },
          { header: "Share %", value: (x) => bpToCsv(x.share) },
        ]),
      };
    }
    case "performance": {
      const p = await getPortfolio(ctx, { includeClosed: true });
      return {
        fileName: `investment-performance-${today}.csv`,
        csv: toCsv(p.holdings, [
          { header: "Holding", value: (h) => h.name },
          { header: "Class", value: (h) => h.assetClass.name },
          { header: "Status", value: (h) => h.status },
          { header: "Currency", value: (h) => h.currency },
          {
            header: "Invested",
            value: (h) => minorToCsv(h.investedMinor, minorUnitDigits(h.currency)),
          },
          {
            header: "Value",
            value: (h) => minorToCsv(h.currentValueMinor, minorUnitDigits(h.currency)),
          },
          {
            header: "Realised",
            value: (h) => minorToCsv(h.realizedGainMinor, minorUnitDigits(h.currency)),
          },
          {
            header: "Unrealised",
            value: (h) => minorToCsv(h.unrealizedGainMinor, minorUnitDigits(h.currency)),
          },
          {
            header: "Income",
            value: (h) => minorToCsv(h.incomeReceivedMinor, minorUnitDigits(h.currency)),
          },
          { header: "XIRR %", value: (h) => bpToCsv(h.xirrBp) },
        ]),
      };
    }
    case "realised": {
      const r = await getRealisedGains(ctx, parseYear(params.year, Number(today.slice(0, 4))));
      return {
        fileName: `realised-gains-${r.year}.csv`,
        csv: toCsv(r.lines, [
          { header: "Date", value: (l) => l.date },
          { header: "Holding", value: (l) => l.holdingName },
          { header: `Amount (${ccy})`, value: (l) => m(l.amountMinor) },
          { header: `Fee (${ccy})`, value: (l) => m(l.feeMinor) },
          { header: `Tax (${ccy})`, value: (l) => m(l.taxMinor) },
          { header: `Cost removed (${ccy})`, value: (l) => m(l.costRemovedMinor) },
          { header: `Realised gain (${ccy})`, value: (l) => m(l.realizedGainMinor) },
        ]),
      };
    }
    case "income": {
      const r = await getInvestmentIncome(ctx, parseYear(params.year, Number(today.slice(0, 4))));
      return {
        fileName: `investment-income-${r.year}.csv`,
        csv: toCsv(r.rows, [
          { header: "Holding", value: (x) => x.holdingName },
          { header: `Gross (${ccy})`, value: (x) => m(x.grossMinor) },
          { header: `Tax withheld (${ccy})`, value: (x) => m(x.taxMinor) },
          { header: `Net (${ccy})`, value: (x) => m(x.netMinor) },
          { header: `Reinvested (${ccy})`, value: (x) => m(x.reinvestedMinor) },
          {
            header: "By kind",
            value: (x) =>
              Object.entries(x.byKind)
                .map(([k, v]) => `${k}: ${m(v)}`)
                .join("; "),
          },
        ]),
      };
    }
    case "net-worth": {
      const { rows } = await getNetWorthHistory(ctx);
      return {
        fileName: `net-worth-history-${today}.csv`,
        csv: toCsv(rows, [
          { header: "Date", value: (r) => r.date },
          { header: `Net worth (${ccy})`, value: (r) => m(r.netWorthMinor) },
          { header: `Assets (${ccy})`, value: (r) => m(r.assetsMinor) },
          { header: `Liabilities (${ccy})`, value: (r) => m(r.liabilitiesMinor) },
          { header: `Invested (${ccy})`, value: (r) => m(r.investedMinor) },
          { header: `Holdings value (${ccy})`, value: (r) => m(r.holdingsValueMinor) },
          { header: `Cash (${ccy})`, value: (r) => m(r.cashMinor) },
        ]),
      };
    }
    default:
      throw new AppError("VALIDATION", "Unknown report");
  }
}
