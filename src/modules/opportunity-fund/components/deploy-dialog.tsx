"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TreeOptions } from "@/modules/allocation/schemas";
import {
  previewDeploymentAction,
  recordDeploymentAction,
} from "@/modules/opportunity-fund/actions";
import type { OpportunityOverviewDTO } from "@/modules/opportunity-fund/schemas";
import { stackOnPhone } from "@/components/shared/mobile/stack-table";
import { cn } from "@/lib/utils";

interface Line {
  assetClassId: string;
  holdingId: string | null;
  amountMinor: number | null;
  feeMinor: number | null;
}

/** Record deployment (docs/05 §8): pre-filled amount and split, editable lines, one atomic save. */
export function DeployDialog({
  open,
  onOpenChange,
  data,
  treeOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: OpportunityOverviewDTO;
  treeOptions: TreeOptions;
}) {
  const router = useRouter();
  const defaultSource =
    data.sources.find((s) => s.id === data.settings.defaultSourceAccountId)?.id ??
    data.sources[0]?.id ??
    "";
  const [sourceId, setSourceId] = useState(defaultSource);
  const [date, setDate] = useState<string | null>(data.todayKey);
  const [amount, setAmount] = useState<number | null>(data.suggestion.amountMinor || null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const source = data.sources.find((s) => s.id === sourceId);
  const currency = source?.currency ?? data.baseCurrency;
  const className = (id: string) => treeOptions.classes.find((c) => c.id === id)?.name ?? "";
  const total = lines.reduce((s, l) => s + (l.amountMinor ?? 0), 0);
  const fees = lines.reduce((s, l) => s + (l.feeMinor ?? 0), 0);

  function split() {
    if (!amount || Number.isNaN(amount)) {
      setError("Enter the amount to deploy");
      return;
    }
    start(async () => {
      const res = await previewDeploymentAction({ amountMinor: amount });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setError(null);
      setLines(res.data.map((l) => ({ ...l, feeMinor: null })));
    });
  }

  function save() {
    start(async () => {
      const res = await recordDeploymentAction({
        date,
        sourceAccountId: sourceId,
        lines: lines.map((l) => ({
          assetClassId: l.assetClassId,
          holdingId: l.holdingId,
          amountMinor: l.amountMinor ?? 0,
          feeMinor: l.feeMinor ?? 0,
        })),
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      toast.success("Deployment recorded");
      onOpenChange(false);
      setLines([]);
      router.refresh();
    });
  }

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record deployment</DialogTitle>
          <DialogDescription>
            Invests opportunity money across your{" "}
            {data.settings.allocationSource === "custom" ? "custom" : "target"} allocation in one
            step. The account’s opportunity earmark goes down by what leaves it.
          </DialogDescription>
        </DialogHeader>

        {!data.sources.length ? (
          <p className="text-sm text-muted-foreground">
            No account holds opportunity money yet. Earmark some on an account or add an Opportunity
            Fund account.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField id="dep-source" label="From">
                <Select
                  value={sourceId}
                  onValueChange={(v) => setSourceId(String(v ?? ""))}
                  items={data.sources.map((s) => ({ value: s.id, label: s.name }))}
                >
                  <SelectTrigger id="dep-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex w-full justify-between gap-3">
                          {s.name}
                          <Money
                            valueMinor={s.opportunityMinor}
                            currency={s.currency}
                            className="text-muted-foreground"
                          />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="dep-date" label="Date">
                <DatePicker id="dep-date" value={date} onChange={setDate} />
              </FormField>
              <FormField id="dep-amount" label="Amount to deploy">
                <MoneyInput
                  id="dep-amount"
                  currency={currency}
                  value={amount}
                  onChange={setAmount}
                />
              </FormField>
            </div>
            {source ? (
              <p className="text-xs text-muted-foreground">
                <Money valueMinor={source.opportunityMinor} currency={source.currency} /> of
                opportunity money on {source.name}.
              </p>
            ) : null}
            <Button type="button" variant="outline" onClick={split} disabled={pending}>
              {lines.length ? "Split again" : "Split by allocation"}
            </Button>

            {lines.length ? (
              <div className="overflow-x-auto rounded-lg border max-md:px-3">
                <table className={cn("w-full text-sm", stackOnPhone)}>
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Holding</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const choices = treeOptions.holdings.filter(
                        (h) =>
                          h.active && h.assetClassId === l.assetClassId && h.currency === currency,
                      );
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">
                            <p className="mb-1 text-xs text-muted-foreground">
                              {className(l.assetClassId)}
                            </p>
                            <Select
                              value={l.holdingId ?? ""}
                              onValueChange={(v) =>
                                setLine(i, { holdingId: String(v ?? "") || null })
                              }
                              items={choices.map((h) => ({ value: h.id, label: h.name }))}
                            >
                              <SelectTrigger
                                aria-label={`Holding for line ${i + 1}`}
                                className="w-full min-w-44"
                              >
                                <SelectValue placeholder="Choose a holding" />
                              </SelectTrigger>
                              <SelectContent>
                                {choices.map((h) => (
                                  <SelectItem key={h.id} value={h.id}>
                                    {h.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              aria-label={`Amount for line ${i + 1}`}
                              currency={currency}
                              value={l.amountMinor}
                              onChange={(v) => setLine(i, { amountMinor: v })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              aria-label={`Fee for line ${i + 1}`}
                              currency={currency}
                              value={l.feeMinor}
                              onChange={(v) => setLine(i, { feeMinor: v })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex flex-wrap justify-between gap-2 border-t px-3 py-2 text-sm">
                  <span>
                    Invested <Money valueMinor={total} currency={currency} />
                    {fees ? (
                      <>
                        {" "}
                        + fees <Money valueMinor={fees} currency={currency} />
                      </>
                    ) : null}
                  </span>
                  <span className="font-medium">
                    Leaves {source?.name}: <Money valueMinor={total + fees} currency={currency} />
                  </span>
                </div>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !lines.length || !sourceId || total <= 0}>
            {pending ? "Saving…" : "Record deployment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
