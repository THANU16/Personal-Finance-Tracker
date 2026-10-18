import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format, parse } from "date-fns";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { isLiability } from "@/domain/accounts";
import { utcToBusinessDate } from "@/domain/dates";
import { AccountActions } from "@/modules/accounts/components/account-actions";
import { ACCOUNT_TYPE_META } from "@/modules/accounts/components/account-meta";
import { UtilisationBar } from "@/modules/accounts/components/accounts-overview";
import { BalanceHistoryChart } from "@/modules/accounts/components/balance-history-chart";
import { getAccountDetail, type AccountDetail as Detail } from "@/modules/accounts/queries";
import { EarmarksCard } from "@/modules/earmarks/components/earmarks-card";
import { getAccountBuckets } from "@/modules/earmarks/queries";
import { QuickAddButton } from "@/modules/transactions/components/quick-add-context";
import { TransactionsTable } from "@/modules/transactions/components/transactions-table";
import { getCurrentUser } from "@/server/auth/require-user";
import { AppError } from "@/server/errors";

const longDate = (key: string) =>
  format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

/** /accounts/[id] content. Render inside <Suspense>. */
export async function AccountDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const { ctx } = current;
  const { id } = await params;
  const pageParam = (await searchParams).page;
  const page = Number(typeof pageParam === "string" ? pageParam : "1") || 1;

  let detail: Detail;
  try {
    detail = await getAccountDetail(ctx, id, page);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { account, rows, history } = detail;
  const buckets = await getAccountBuckets(ctx, account.id);
  const showBuckets = !account.archived && (buckets.canCarryEarmarks || buckets.dedicated !== null);
  const meta = ACCOUNT_TYPE_META[account.type];
  const todayKey = utcToBusinessDate(new Date(), ctx.tz);
  const liability = isLiability(account.type);
  const quickAddType = liability || account.type === "receivable" ? "transfer" : "expense";

  return (
    <>
      <Link
        href="/accounts"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Accounts
      </Link>
      <PageHeader
        title={account.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {meta.label}
            {account.institution ? ` · ${account.institution}` : ""}
            {account.counterparty ? ` · ${account.counterparty}` : ""}
            {account.archived ? <Badge variant="secondary">Archived</Badge> : null}
          </span>
        }
        actions={
          <>
            {!account.archived ? (
              <QuickAddButton
                label="Add transaction"
                request={{ mode: "create", type: quickAddType, accountId: account.id }}
              />
            ) : null}
            <AccountActions
              account={account}
              todayKey={todayKey}
              baseCurrency={ctx.baseCurrency}
              variant="buttons"
            />
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {account.card ? (
          <>
            <StatCard
              label="Outstanding"
              value={
                <Money valueMinor={account.card.outstandingMinor} currency={account.currency} />
              }
            />
            {account.creditCard ? (
              <StatCard
                label="Credit limit"
                value={
                  <Money valueMinor={account.creditCard.limitMinor} currency={account.currency} />
                }
                hint={
                  account.card.utilisationBp !== null ? (
                    <UtilisationBar bp={account.card.utilisationBp} />
                  ) : null
                }
              />
            ) : null}
            <StatCard
              label="Next due"
              value={longDate(account.card.nextDueDate)}
              hint={
                account.creditCard ? `Statement on day ${account.creditCard.statementDay}` : null
              }
            />
          </>
        ) : (
          <StatCard
            label={liability ? "Owed" : "Balance"}
            value={
              <Money
                valueMinor={liability ? -account.balanceMinor : account.balanceMinor}
                currency={account.currency}
              />
            }
          />
        )}
        <StatCard
          label="Opening balance"
          value={<Money valueMinor={account.openingBalanceMinor} currency={account.currency} />}
          hint={`on ${longDate(account.openingDate)}`}
        />
      </div>

      {showBuckets ? (
        <div className="mb-4">
          <EarmarksCard accountName={account.name} buckets={buckets} />
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Balance history</CardTitle>
        </CardHeader>
        <CardContent>
          <BalanceHistoryChart points={history} currency={account.currency} />
        </CardContent>
      </Card>

      <h2 className="mb-2 text-lg font-semibold">Transactions</h2>
      {rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="No transactions yet"
          description="Transactions you record against this account appear here with a running balance."
          action={
            !account.archived ? (
              <QuickAddButton
                label="Add transaction"
                request={{ mode: "create", type: quickAddType, accountId: account.id }}
              />
            ) : undefined
          }
        />
      ) : (
        <>
          <TransactionsTable
            rows={rows.map((r) => ({
              txn: r.txn,
              deltaMinor: r.deltaMinor,
              balanceMinor: r.balanceMinor,
              currency: account.currency,
            }))}
          />
          {detail.pageCount > 1 ? (
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {detail.page} of {detail.pageCount}
              </span>
              <div className="flex gap-2">
                {detail.page > 1 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/accounts/${account.id}?page=${detail.page - 1}`} />}
                  >
                    Newer
                  </Button>
                ) : null}
                {detail.page < detail.pageCount ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/accounts/${account.id}?page=${detail.page + 1}`} />}
                  >
                    Older
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
