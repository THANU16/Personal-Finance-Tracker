import Link from "next/link";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import type { DebtDetailDTO } from "@/modules/debts/schemas";

// Owner request: what has been paid on a loan and what it costs in interest over its whole life.
// Only the total interest is shown — how a lender splits it per instalment varies by scheme.

export function LoanCostCards({ debt: d, loanHref }: { debt: DebtDetailDTO; loanHref?: string }) {
  // Every payment counts (instalments, prepayments) plus the instalments paid before tracking.
  const n = d.payments.filter((p) => p.status === "posted").length + d.paidBeforeTracking;
  return (
    <>
      <StatCard
        label="Total paid so far"
        value={<Money valueMinor={d.totalPaidMinor} currency={d.currency} />}
        hint={
          <>
            {n} payment{n === 1 ? "" : "s"}
            {d.paidBeforeTracking > 0 ? (
              <>
                {" "}
                · incl. ~<Money
                  valueMinor={d.paidBeforeTrackingMinor}
                  currency={d.currency}
                /> for {d.paidBeforeTracking} before tracking
              </>
            ) : null}
          </>
        }
      />
      <StatCard
        label="Total interest of this loan"
        value={
          d.totalInterestMinor === null ? (
            "—"
          ) : (
            <Money valueMinor={d.totalInterestMinor} currency={d.currency} />
          )
        }
        hint={
          <>
            {d.totalInterestMinor === null ? (
              "Can't project: the EMI no longer covers the interest"
            ) : (
              <>
                on <Money valueMinor={d.principalMinor} currency={d.currency} /> borrowed
              </>
            )}
            {loanHref ? (
              <>
                {" · "}
                <Link href={loanHref} className="underline underline-offset-4">
                  Open loan
                </Link>
              </>
            ) : null}
          </>
        }
      />
    </>
  );
}
