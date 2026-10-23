"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BucketBar } from "@/components/shared/bucket-bar";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  effectiveEarmarks,
  moveBetweenBuckets,
  type Bucket,
  type BucketSlot,
  type EarmarkLike,
  type EarmarkMode,
  type EffectiveEarmarks,
} from "@/domain/earmarks";
import {
  moveBetweenBucketsAction,
  moveHoldingBucketsAction,
  setEarmarkAction,
  setHoldingEarmarkAction,
} from "@/modules/earmarks/actions";
import type { AccountBucketsDTO } from "@/modules/earmarks/schemas";
import type { HoldingBucketsDTO } from "@/modules/earmarks/holding-service";

/** Buckets of an account or (owner request) of a holding — the dialog works on either. */
export type BucketsView = AccountBucketsDTO | HoldingBucketsDTO;
const isHolding = (b: BucketsView): b is HoldingBucketsDTO => "holdingId" in b;

const SLOT_LABEL: Record<BucketSlot, string> = {
  free: "Free cash",
  emergency: "Emergency",
  opportunity: "Opportunity",
};
const SLOT_ITEMS = (Object.keys(SLOT_LABEL) as BucketSlot[]).map((value) => ({
  value,
  label: SLOT_LABEL[value],
}));

type Tab = "set" | "move";

function storedAfterMove(
  buckets: BucketsView,
  from: BucketSlot,
  to: BucketSlot,
  amountMinor: number,
): EarmarkLike[] {
  const next = moveBetweenBuckets(buckets, from, to, amountMinor);
  const out: EarmarkLike[] = [];
  for (const bucket of ["emergency", "opportunity"] as const) {
    const changed = bucket === "emergency" ? next.emergencyMinor : next.opportunityMinor;
    const current = buckets.earmarks.find((e) => e.bucket === bucket);
    if (changed !== null) {
      if (changed > 0) out.push({ bucket, mode: "fixed", amountMinor: changed });
    } else if (current) {
      out.push(current);
    }
  }
  return out;
}

/** "Earmark / Move between buckets" (docs/05 §3). Live result uses the same rules as the server. */
export function EarmarkDialog({
  open,
  onOpenChange,
  accountName,
  buckets,
  initialBucket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  buckets: BucketsView;
  initialBucket?: Bucket;
}) {
  const holding = isHolding(buckets);
  const router = useRouter();
  const existing = (b: Bucket) => buckets.earmarks.find((e) => e.bucket === b);
  const [tab, setTab] = useState<Tab>("set");
  const [bucket, setBucket] = useState<Bucket>(initialBucket ?? "emergency");
  const [mode, setMode] = useState<EarmarkMode>(existing(bucket)?.mode ?? "fixed");
  const [amountMinor, setAmountMinor] = useState<number | null>(
    existing(bucket)?.amountMinor ?? null,
  );
  const [percentBp, setPercentBp] = useState<number | null>(existing(bucket)?.percentBp ?? null);
  const [from, setFrom] = useState<BucketSlot>("free");
  const [to, setTo] = useState<BucketSlot>("emergency");
  const [moveMinor, setMoveMinor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const B = buckets.balanceMinor;
  const ccy = buckets.currency;

  function pickBucket(b: Bucket) {
    setBucket(b);
    const e = existing(b);
    setMode(e?.mode ?? "fixed");
    setAmountMinor(e?.amountMinor ?? null);
    setPercentBp(e?.percentBp ?? null);
    setError(null);
  }

  const preview = useMemo((): { result: EffectiveEarmarks | null; problem: string | null } => {
    if (tab === "set") {
      const value = mode === "fixed" ? amountMinor : percentBp;
      if (!value || value <= 0) return { result: null, problem: null };
      const others = buckets.earmarks.filter((e) => e.bucket !== bucket);
      const next: EarmarkLike =
        mode === "fixed"
          ? { bucket, mode, amountMinor: value }
          : { bucket, mode, percentBp: value };
      const result = effectiveEarmarks(B, [...others, next]);
      return {
        result,
        problem: result.overEarmarked
          ? holding
            ? "Earmarks would be more than the holding's value"
            : "Earmarks would be more than the account balance"
          : null,
      };
    }
    if (!moveMinor || moveMinor <= 0) return { result: null, problem: null };
    if (from === to) return { result: null, problem: "Choose two different buckets" };
    try {
      return {
        result: effectiveEarmarks(B, storedAfterMove(buckets, from, to, moveMinor)),
        problem: null,
      };
    } catch {
      return { result: null, problem: `Not enough in ${SLOT_LABEL[from].toLowerCase()}` };
    }
  }, [tab, mode, amountMinor, percentBp, bucket, buckets, B, moveMinor, from, to, holding]);

  async function submit() {
    setError(null);
    setPending(true);
    const owner = isHolding(buckets)
      ? { holdingId: buckets.holdingId }
      : { accountId: buckets.accountId };
    const setInput =
      mode === "fixed"
        ? { ...owner, bucket, mode, amountMinor: amountMinor ?? 0 }
        : { ...owner, bucket, mode, percentBp: percentBp ?? 0 };
    const moveInput = { ...owner, from, to, amountMinor: moveMinor ?? 0 };
    const result =
      tab === "set"
        ? await (holding ? setHoldingEarmarkAction(setInput) : setEarmarkAction(setInput))
        : await (holding
            ? moveHoldingBucketsAction(moveInput)
            : moveBetweenBucketsAction(moveInput));
    setPending(false);
    if (!result.ok) {
      const fieldMessage = Object.values(result.error.fieldErrors ?? {})[0]?.[0];
      setError(fieldMessage ?? result.error.message);
      return;
    }
    toast.success(tab === "set" ? "Earmark saved" : "Moved between buckets");
    onOpenChange(false);
    router.refresh();
  }

  const current: EffectiveEarmarks = buckets;
  const shown = preview.result ?? current;
  const problem = error ?? preview.problem;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Earmark money in {accountName}</DialogTitle>
          <DialogDescription>
            {holding
              ? "Mark part of this asset as emergency or opportunity money. It stays invested and nothing is sold; selling beyond the free part will ask you first."
              : "Set money aside for emergencies or opportunities. Nothing leaves the account and no transaction is recorded; spending beyond free cash will ask you first."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => (setTab(v as Tab), setError(null))}>
          <TabsList>
            <TabsTrigger value="set">Set an earmark</TabsTrigger>
            <TabsTrigger value="move">Move between buckets</TabsTrigger>
          </TabsList>

          <TabsContent value="set" className="grid gap-4 pt-3">
            <div className="grid gap-2">
              <Label id="earmark-bucket-label">Bucket</Label>
              <RadioGroup
                aria-labelledby="earmark-bucket-label"
                value={bucket}
                onValueChange={(v) => pickBucket(v as Bucket)}
                className="grid-cols-2"
              >
                {(["emergency", "opportunity"] as const).map((b) => (
                  <Label
                    key={b}
                    className="flex items-center gap-2 rounded-lg border p-2.5 font-normal"
                  >
                    <RadioGroupItem value={b} />
                    {SLOT_LABEL[b]}
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <div className="grid gap-2">
              <Label id="earmark-mode-label">Amount as</Label>
              <RadioGroup
                aria-labelledby="earmark-mode-label"
                value={mode}
                onValueChange={(v) => setMode(v as EarmarkMode)}
                className="grid-cols-2"
              >
                <Label className="flex items-center gap-2 rounded-lg border p-2.5 font-normal">
                  <RadioGroupItem value="fixed" /> Fixed amount
                </Label>
                <Label className="flex items-center gap-2 rounded-lg border p-2.5 font-normal">
                  <RadioGroupItem value="percent" /> {holding ? "% of value" : "% of balance"}
                </Label>
              </RadioGroup>
            </div>
            {mode === "fixed" ? (
              <FormField id="earmark-amount" label="Amount">
                <MoneyInput
                  id="earmark-amount"
                  currency={ccy}
                  value={amountMinor}
                  onChange={setAmountMinor}
                  {...fieldAria("earmark-amount", undefined)}
                />
              </FormField>
            ) : (
              <FormField
                id="earmark-percent"
                label={holding ? "Percent of value" : "Percent of balance"}
                description={
                  holding
                    ? "Follows the value as it changes."
                    : "Follows the balance as it changes."
                }
              >
                <PercentInput
                  id="earmark-percent"
                  value={percentBp}
                  onChange={setPercentBp}
                  {...fieldAria("earmark-percent", undefined, true)}
                />
              </FormField>
            )}
          </TabsContent>

          <TabsContent value="move" className="grid gap-4 pt-3">
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["move-from", "From", from, setFrom],
                  ["move-to", "To", to, setTo],
                ] as const
              ).map(([id, label, value, set]) => (
                <FormField key={id} id={id} label={label}>
                  <Select
                    value={value}
                    onValueChange={(v) => set(v as BucketSlot)}
                    items={SLOT_ITEMS}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SLOT_ITEMS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ))}
            </div>
            <FormField id="move-amount" label="Amount to move">
              <MoneyInput
                id="move-amount"
                currency={ccy}
                value={moveMinor}
                onChange={setMoveMinor}
                {...fieldAria("move-amount", undefined)}
              />
            </FormField>
          </TabsContent>
        </Tabs>

        <div className="grid gap-2 rounded-lg border p-3" aria-live="polite">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{preview.result ? "After" : "Now"}</span>
            <span className="text-muted-foreground">
              {holding ? "Value" : "Balance"} <Money valueMinor={B} currency={ccy} />
            </span>
          </div>
          <BucketBar
            emergencyMinor={shown.emergencyMinor}
            opportunityMinor={shown.opportunityMinor}
            freeMinor={shown.freeMinor}
            currency={ccy}
          />
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={pending || !preview.result || !!preview.problem}
          >
            {pending ? "Saving…" : tab === "set" ? "Save earmark" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
