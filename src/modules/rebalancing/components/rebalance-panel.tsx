"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TradeLine } from "@/domain/drift";
import { cashflowPlanAction, tiltNextSipAction } from "@/modules/rebalancing/actions";
import type { NextSip } from "@/modules/rebalancing/service";
import { useQuickAdd } from "@/modules/transactions/components/quick-add-context";

interface Names {
  classes: Record<string, string>;
  holdings: Record<string, { name: string; isFd: boolean }>;
}

function LineLabel({
  line,
  names,
}: {
  line: { assetClassId: string; holdingId: string | null };
  names: Names;
}) {
  return (
    <span className="grid">
      <span className="font-medium">
        {line.holdingId
          ? (names.holdings[line.holdingId]?.name ?? "Holding")
          : `Any ${names.classes[line.assetClassId] ?? "holding"}`}
      </span>
      <span className="text-xs text-muted-foreground">
        {names.classes[line.assetClassId] ?? "Asset class"}
      </span>
    </span>
  );
}

/** docs/05 §7 — "Invest new money" (cashflow rebalance) and "Full rebalance" with Apply. */
export function RebalancePanel({
  currency,
  trades,
  names,
  nextSips,
}: {
  currency: string;
  trades: TradeLine[];
  names: Names;
  nextSips: NextSip[];
}) {
  const router = useRouter();
  const { open } = useQuickAdd();
  const [tab, setTab] = useState<"invest" | "full">("invest");
  const [amount, setAmount] = useState<number | null>(null);
  const [plan, setPlan] = useState<
    { assetClassId: string; holdingId: string | null; amountMinor: number }[] | null
  >(null);
  const [pending, setPending] = useState(false);
  const [sipPlan, setSipPlan] = useState(nextSips[0]?.planId ?? "");

  async function suggest() {
    setPending(true);
    const result = await cashflowPlanAction(amount ?? 0);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setPlan(result.data);
  }

  async function tilt() {
    const result = await tiltNextSipAction(sipPlan);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      `${result.data.planName} (${result.data.dueDate}) will open with the drift-tilted split`,
    );
    router.refresh();
  }

  const apply = (holdingId: string | null, amountMinor: number, sell: boolean) =>
    open({
      mode: "create",
      type: sell ? "redeem" : "invest",
      holdingId: holdingId ?? undefined,
      amountMinor,
    });

  const buys = trades.filter((t) => t.tradeMinor > 0);
  const sells = trades.filter((t) => t.tradeMinor < 0);

  return (
    <div className="grid gap-4">
      <div
        role="group"
        aria-label="Rebalance mode"
        className="flex w-fit rounded-lg bg-muted p-0.5 text-sm"
      >
        {(
          [
            ["invest", "Invest new money"],
            ["full", "Full rebalance"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1 ${tab === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "invest" ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Puts new money where you are furthest below target. It only buys — nothing is sold.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="new-money">Amount to invest</Label>
              <MoneyInput
                id="new-money"
                currency={currency}
                value={amount}
                onChange={setAmount}
                className="w-56"
              />
            </div>
            <Button onClick={() => void suggest()} disabled={pending || !amount}>
              {pending ? "Working…" : "Suggest split"}
            </Button>
          </div>
          {plan ? (
            plan.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to suggest.</p>
            ) : (
              <ul className="divide-y rounded-lg border" aria-label="Suggested buys">
                {plan.map((l, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                  >
                    <LineLabel line={l} names={names} />
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">
                        Buy <Money valueMinor={l.amountMinor} currency={currency} />
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => apply(l.holdingId, l.amountMinor, false)}
                      >
                        Apply
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Buys and sells that bring every holding back to its target. Buys and sells balance out
            to zero.
          </p>
          {trades.every((t) => t.tradeMinor === 0) ? (
            <p className="text-sm text-muted-foreground">You are on target — nothing to trade.</p>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Rebalancing trades">
              {[...sells, ...buys].map((t, i) => {
                const sell = t.tradeMinor < 0;
                return (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                  >
                    <LineLabel line={t} names={names} />
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        <Money valueMinor={t.valueMinor} currency={currency} /> →{" "}
                        <Money valueMinor={t.targetMinor} currency={currency} />
                      </span>
                      <span className="w-40 text-right font-medium tabular-nums">
                        {sell ? "Sell" : "Buy"}{" "}
                        <Money valueMinor={Math.abs(t.tradeMinor)} currency={currency} />
                      </span>
                      {t.isFd ? (
                        <span className="text-xs text-muted-foreground">
                          Withdraw or renew the FD instead
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => apply(t.holdingId, Math.abs(t.tradeMinor), sell)}
                        >
                          Apply
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-2 rounded-lg border p-3">
        <span className="text-sm font-medium">Use for next SIP</span>
        {nextSips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SIP plan has an upcoming period.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={sipPlan}
              onValueChange={(v) => v && setSipPlan(v)}
              items={nextSips.map((s) => ({
                value: s.planId,
                label: `${s.planName} · ${s.dueDate}`,
              }))}
            >
              <SelectTrigger aria-label="SIP plan" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {nextSips.map((s) => (
                  <SelectItem key={s.planId} value={s.planId}>
                    {s.planName} · {s.dueDate}
                    {s.useTilt ? " (tilted)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void tilt()} disabled={!sipPlan}>
              Tilt next period
            </Button>
            <span className="text-xs text-muted-foreground">
              Its Execute screen opens on the drift-tilted split.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
