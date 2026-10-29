import Link from "next/link";
import { redirect } from "next/navigation";
import { format, parse } from "date-fns";
import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BucketBar } from "@/components/shared/bucket-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { utcToBusinessDate } from "@/domain/dates";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AccountActions, AddAccountButton } from "@/modules/accounts/components/account-actions";
import { ACCOUNT_TYPE_META } from "@/modules/accounts/components/account-meta";
import { getAccountsOverview } from "@/modules/accounts/queries";
import { listAccountBuckets } from "@/modules/earmarks/queries";
import type { AccountBucketsDTO } from "@/modules/earmarks/schemas";
import type { AccountDTO } from "@/modules/accounts/schemas";
import { getCurrentUser } from "@/server/auth/require-user";

const shortDate = (key: string) => format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM");

/** Credit limit used: a bar plus the percentage in text (never colour alone). */
export function UtilisationBar({ bp }: { bp: number }) {
  const pct = Math.min(100, bp / 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Credit limit used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={cn("h-full rounded-full", bp >= 9_000 ? "bg-destructive" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{formatPercentBp(bp)} used</span>
    </div>
  );
}

function BucketsLine({ buckets }: { buckets: AccountBucketsDTO }) {
  if (buckets.archived) return null;
  if (buckets.dedicated) {
    return (
      <div className="mt-1 text-xs text-muted-foreground">
        All {buckets.dedicated} money ·{" "}
        <Money
          valueMinor={
            buckets.dedicated === "emergency" ? buckets.emergencyMinor : buckets.opportunityMinor
          }
          currency={buckets.currency}
        />
      </div>
    );
  }
  if (!buckets.earmarkable || buckets.earmarks.length === 0) return null;
  return (
    <BucketBar
      className="mt-1.5 max-w-sm"
      emergencyMinor={buckets.emergencyMinor}
      opportunityMinor={buckets.opportunityMinor}
      freeMinor={buckets.freeMinor}
      currency={buckets.currency}
    />
  );
}

function AccountRow({
  account,
  buckets,
  todayKey,
  baseCurrency,
}: {
  account: AccountDTO;
  buckets: AccountBucketsDTO | undefined;
  todayKey: string;
  baseCurrency: string;
}) {
  const meta = ACCOUNT_TYPE_META[account.type];
  const sub = account.counterparty ?? account.institution ?? meta.label;
  // Earmarks and card details (docs/07 §2, audit ACC-01).
  const details = (
    <>
      {buckets ? <BucketsLine buckets={buckets} /> : null}
      {account.card ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {account.card.utilisationBp !== null ? (
            <UtilisationBar bp={account.card.utilisationBp} />
          ) : null}
          {account.creditCard ? (
            <span>
              Limit <Money valueMinor={account.creditCard.limitMinor} currency={account.currency} />
            </span>
          ) : null}
          <span>Due {shortDate(account.card.nextDueDate)}</span>
        </div>
      ) : null}
    </>
  );
  // Mirrors when BucketsLine / the card line render, so phones only get a line when needed.
  const phoneDetails =
    Boolean(
      buckets &&
      !buckets.archived &&
      (buckets.dedicated || (buckets.earmarkable && buckets.earmarks.length > 0)),
    ) || Boolean(account.card);
  return (
    // Details are rendered once. Desktop: under the name in the middle column, as before. Phones:
    // the middle column dissolves (`contents`) and the details wrap to a full-width last line, so
    // they never run into the balance.
    <li className="flex items-center gap-3 py-3 max-md:flex-wrap max-md:gap-y-1">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <meta.icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 max-md:contents">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/accounts/${account.id}`}
              className="truncate font-medium hover:underline focus-visible:underline max-md:-my-3 max-md:py-3"
            >
              {account.name}
            </Link>
            {account.archived ? <Badge variant="secondary">Archived</Badge> : null}
            {buckets?.overEarmarked && !account.archived ? (
              <Badge variant="destructive">Over-earmarked</Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        </div>
        {phoneDetails ? (
          <div className="max-md:order-last max-md:basis-full max-md:pl-12">{details}</div>
        ) : null}
      </div>
      <div className="text-right">
        {account.card ? (
          <>
            <Money
              valueMinor={account.card.outstandingMinor}
              currency={account.currency}
              className="font-medium"
            />
            <div className="text-xs text-muted-foreground">outstanding</div>
          </>
        ) : (
          <Money
            valueMinor={account.balanceMinor}
            currency={account.currency}
            className="font-medium"
          />
        )}
      </div>
      <AccountActions
        account={account}
        buckets={buckets}
        todayKey={todayKey}
        baseCurrency={baseCurrency}
      />
    </li>
  );
}

/** Session-dependent header action. Render inside <Suspense>. */
export async function AddAccountAction() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return (
    <AddAccountButton
      todayKey={utcToBusinessDate(new Date(), current.ctx.tz)}
      baseCurrency={current.ctx.baseCurrency}
    />
  );
}

/** /accounts content: groups with subtotals. Render inside <Suspense>. */
export async function AccountsOverview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const showArchived = (await searchParams).archived === "1";
  const { ctx } = current;
  const todayKey = utcToBusinessDate(new Date(), ctx.tz);
  const [{ groups, archivedCount }, buckets] = await Promise.all([
    getAccountsOverview(ctx, { includeArchived: showArchived }),
    listAccountBuckets(ctx),
  ]);

  if (groups.length === 0 && archivedCount === 0) {
    return (
      <EmptyState
        icon={<Landmark />}
        title="No accounts yet"
        description="Add your bank accounts, cash, cards and loans with today's balances. Every transaction then keeps them up to date."
        action={<AddAccountButton todayKey={todayKey} baseCurrency={ctx.baseCurrency} />}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="flex flex-row items-baseline justify-between gap-4">
            <CardTitle>{group.label}</CardTitle>
            <div className="flex flex-col items-end gap-1 text-sm">
              <Money
                valueMinor={group.subtotal.totalMinor}
                currency={group.subtotal.currency}
                className="font-semibold"
              />
              {group.fxMissing > 0 ? (
                <Badge variant="outline" title="Add the rate in Settings → FX rates">
                  FX rate missing · {group.fxMissing} not included
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {group.accounts.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  buckets={buckets.get(a.id)}
                  todayKey={todayKey}
                  baseCurrency={ctx.baseCurrency}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {archivedCount > 0 ? (
        <Link
          href={showArchived ? "/accounts" : "/accounts?archived=1"}
          className="justify-self-start text-sm text-muted-foreground underline underline-offset-4"
        >
          {showArchived ? "Hide archived accounts" : `Show ${archivedCount} archived`}
        </Link>
      ) : null}
    </div>
  );
}
