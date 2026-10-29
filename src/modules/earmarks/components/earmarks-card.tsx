"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BucketBar } from "@/components/shared/bucket-bar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Bucket } from "@/domain/earmarks";
import { formatPercentBp } from "@/lib/format";
import { removeEarmarkAction, removeHoldingEarmarkAction } from "@/modules/earmarks/actions";
import { EarmarkDialog, type BucketsView } from "@/modules/earmarks/components/earmark-dialog";

const LABEL: Record<Bucket, string> = { emergency: "Emergency", opportunity: "Opportunity" };

/** Account or holding detail: buckets and the earmarks behind them (docs/05 §3). */
export function EarmarksCard({
  accountName,
  buckets,
}: {
  accountName: string;
  buckets: BucketsView;
}) {
  const holding = "holdingId" in buckets;
  // Earmarkable now: accounts as computed on the server; holdings when they can carry and have value.
  const earmarkable =
    "holdingId" in buckets
      ? buckets.canCarryEarmarks && buckets.balanceMinor > 0
      : buckets.earmarkable;
  const router = useRouter();
  const [dialog, setDialog] = useState<{ bucket?: Bucket } | null>(null);
  const ccy = buckets.currency;

  async function remove(bucket: Bucket) {
    const result =
      "holdingId" in buckets
        ? await removeHoldingEarmarkAction({ holdingId: buckets.holdingId, bucket })
        : await removeEarmarkAction({ accountId: buckets.accountId, bucket });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success(`${LABEL[bucket]} earmark removed`);
    router.refresh();
  }

  if (buckets.dedicated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{LABEL[buckets.dedicated]} money</CardTitle>
          <CardDescription>
            {holding
              ? "This holding counts toward your emergency fund as a whole. To keep only part of it as emergency money, turn that off and add an earmark instead."
              : buckets.dedicated === "emergency"
                ? "This account counts toward your emergency fund as a whole. Taking money out asks you first."
                : "This is an Opportunity Fund account: all of it is opportunity money. Taking money out asks you first."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col items-start justify-between gap-4 md:flex-row">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2">
            Earmarks
            {buckets.overEarmarked ? <Badge variant="destructive">Over-earmarked</Badge> : null}
          </CardTitle>
          <CardDescription>
            {holding
              ? "Emergency or opportunity money kept in this asset (it stays invested). Selling beyond the free part asks you first."
              : buckets.accountType === "receivable"
                ? 'Which part of this money you lent came from your emergency or opportunity fund. Record the repayment with "Take from" to put it back in the same bucket.'
                : "Money set aside inside this account. Spending beyond free cash asks you first."}
          </CardDescription>
        </div>
        {earmarkable ? (
          <Button variant="outline" onClick={() => setDialog({})}>
            Earmark / move
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <BucketBar
          emergencyMinor={buckets.emergencyMinor}
          opportunityMinor={buckets.opportunityMinor}
          freeMinor={buckets.freeMinor}
          currency={ccy}
        />
        {buckets.overEarmarked ? (
          <p className="text-sm text-muted-foreground">
            The earmarks add up to more than the {holding ? "value" : "balance"}, so opportunity
            (then emergency) is shown reduced. Lower an earmark{holding ? "" : " or add money"} to
            fix it.
          </p>
        ) : null}
        {!earmarkable && buckets.earmarks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Earmarks need a {holding ? "value" : "balance"} above zero.
          </p>
        ) : null}
        {buckets.earmarks.length > 0 ? (
          <ul className="divide-y rounded-lg border" aria-label="Earmarks">
            {buckets.earmarks.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="grid gap-0.5 text-sm">
                  <span className="font-medium">{LABEL[e.bucket]}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.mode === "percent" ? (
                      <>
                        {formatPercentBp(e.percentBp ?? 0)} of {holding ? "value" : "balance"} ·{" "}
                        <Money valueMinor={e.rawMinor} currency={ccy} />
                      </>
                    ) : (
                      <>
                        Fixed · <Money valueMinor={e.amountMinor ?? 0} currency={ccy} />
                      </>
                    )}
                  </span>
                </div>
                <div className="flex gap-2">
                  {earmarkable ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ bucket: e.bucket })}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm">
                        Remove
                      </Button>
                    }
                    title={`Remove the ${LABEL[e.bucket].toLowerCase()} earmark?`}
                    description={
                      holding
                        ? "The value stays invested and becomes free. Nothing is sold."
                        : "The money stays in the account and becomes free cash. No transaction is recorded."
                    }
                    confirmLabel="Remove"
                    onConfirm={() => remove(e.bucket)}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      {dialog ? (
        <EarmarkDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          accountName={accountName}
          buckets={buckets}
          initialBucket={dialog.bucket}
        />
      ) : null}
    </Card>
  );
}
