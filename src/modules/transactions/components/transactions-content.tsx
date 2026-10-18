import Link from "next/link";
import { redirect } from "next/navigation";
import { format, parse } from "date-fns";
import { ArrowLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { listAccounts } from "@/modules/accounts/service";
import { getCategoryTree } from "@/modules/categories/service";
import { listTags, listTransactions, type TransactionsPage } from "@/modules/transactions/queries";
import { transactionFiltersSchema } from "@/modules/transactions/schemas";
import { QuickAddButton } from "@/modules/transactions/components/quick-add-context";
import { TransactionFilters } from "@/modules/transactions/components/transaction-filters";
import { TransactionsTable } from "@/modules/transactions/components/transactions-table";
import { getCurrentUser } from "@/server/auth/require-user";
import { AppError } from "@/server/errors";

type SearchParams = Record<string, string | string[] | undefined>;

const label = (key: string) => format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

function flatParams(sp: SearchParams): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : Array.isArray(v) && v[0] ? [[k, v[0]]] : [],
    ),
  );
}

function rangeLabel(range: TransactionsPage["range"]): string {
  if (!range.from && !range.to) return "All time";
  if (range.from && range.to) return `${label(range.from)} – ${label(range.to)}`;
  return range.from ? `From ${label(range.from)}` : `Until ${label(range.to!)}`;
}

function Pagination({
  page,
  pageCount,
  params,
}: {
  page: number;
  pageCount: number;
  params: Record<string, string>;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number) =>
    `/transactions?${new URLSearchParams({ ...params, page: String(p) }).toString()}`;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" render={<Link href={href(page - 1)} />}>
            Previous
          </Button>
        ) : null}
        {page < pageCount ? (
          <Button variant="outline" size="sm" render={<Link href={href(page + 1)} />}>
            Next
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

/** /transactions content: summary strip, filters, ledger table. Render inside <Suspense>. */
export async function TransactionsContent({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx } = current;
  const params = flatParams(await searchParams);
  const filters = transactionFiltersSchema.parse(params);

  let page: TransactionsPage;
  try {
    page = await listTransactions(ctx, filters);
  } catch (err) {
    // A stale category/account id in the URL: show everything instead of failing.
    if (err instanceof AppError && err.code === "NOT_FOUND") redirect("/transactions");
    throw err;
  }
  const [accounts, categories, tags] = await Promise.all([
    listAccounts(ctx, { includeArchived: true }),
    getCategoryTree(ctx),
    listTags(ctx),
  ]);
  const { summary } = page;

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Income"
          value={<Money valueMinor={summary.incomeMinor} currency={summary.currency} />}
          hint={rangeLabel(page.range)}
        />
        <StatCard
          label="Expense"
          value={<Money valueMinor={summary.expenseMinor} currency={summary.currency} />}
          hint={rangeLabel(page.range)}
        />
        <StatCard
          label="Net"
          value={
            <Money
              valueMinor={summary.netMinor}
              currency={summary.currency}
              signed={summary.netMinor > 0}
            />
          }
          hint={
            summary.fxMissingCount > 0 ? (
              <span className="flex items-center gap-1">
                <Badge variant="outline">FX rate missing</Badge>
                {summary.fxMissingCount} not included — add rates in Settings
              </span>
            ) : (
              "Income − expense"
            )
          }
        />
      </div>

      <TransactionFilters
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.archived ? `${a.name} (archived)` : a.name,
        }))}
        categories={categories}
        tags={tags}
        baseCurrency={ctx.baseCurrency}
      />

      {page.rows.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight />}
          title={
            page.total === 0 && Object.keys(params).length === 0
              ? "No transactions this month"
              : "Nothing matches these filters"
          }
          description="Record spending, income and transfers with Quick add (or press N)."
          action={<QuickAddButton label="Add transaction" />}
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {page.total} transaction{page.total === 1 ? "" : "s"}
          </p>
          <TransactionsTable rows={page.rows.map((txn) => ({ txn }))} />
          <Pagination page={page.page} pageCount={page.pageCount} params={params} />
        </>
      )}
    </>
  );
}
