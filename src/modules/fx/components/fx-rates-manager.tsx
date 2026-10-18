"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteFxRateAction, saveFxRateAction } from "@/modules/fx/actions";
import type { FxRateDTO } from "@/modules/fx/schemas";

interface Draft {
  id?: string;
  date: string;
  base: string;
  quote: string;
  rate: string;
}

function RateDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((d) => ({ ...d, [k]: k === "rate" ? e.target.value : e.target.value.toUpperCase() }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rate = Number(v.rate.replace(/,/g, ""));
    setPending(true);
    const result = await saveFxRateAction(
      {
        date: v.date,
        base: v.base.trim(),
        quote: v.quote.trim(),
        rate: Number.isFinite(rate) ? rate : -1,
      },
      v.id,
    );
    setPending(false);
    if (!result.ok) {
      setErrors(
        Object.fromEntries(
          Object.entries(result.error.fieldErrors ?? {}).map(([k, m]) => [k, m[0] ?? ""]),
        ),
      );
      toast.error(result.error.message);
      return;
    }
    toast.success("FX rate saved");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={save} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{v.id ? "Edit FX rate" : "Add FX rate"}</DialogTitle>
            <DialogDescription>
              How many units of the second currency one unit of the first buys. Totals use the
              latest rate on or before each date.
            </DialogDescription>
          </DialogHeader>
          <FormField id="fx-date" label="Date" error={errors.date}>
            <DatePicker
              id="fx-date"
              value={v.date}
              onChange={(date) => setV((d) => ({ ...d, date: date ?? d.date }))}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="fx-base" label="1 unit of" error={errors.base}>
              <Input
                id="fx-base"
                maxLength={3}
                value={v.base}
                onChange={set("base")}
                {...fieldAria("fx-base", errors.base)}
              />
            </FormField>
            <FormField id="fx-quote" label="Equals (currency)" error={errors.quote}>
              <Input
                id="fx-quote"
                maxLength={3}
                value={v.quote}
                onChange={set("quote")}
                {...fieldAria("fx-quote", errors.quote)}
              />
            </FormField>
          </div>
          <FormField
            id="fx-rate"
            label="Rate"
            error={errors.rate}
            description={
              v.base && v.quote && v.rate ? `1 ${v.base} = ${v.rate} ${v.quote}` : undefined
            }
          >
            <Input
              id="fx-rate"
              inputMode="decimal"
              value={v.rate}
              onChange={set("rate")}
              {...fieldAria("fx-rate", errors.rate, true)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save rate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → FX rates (docs/05 §17). Missing rates leave amounts out of totals (never 1:1). */
export function FxRatesManager({
  rates,
  baseCurrency,
  todayKey,
}: {
  rates: FxRateDTO[];
  baseCurrency: string;
  todayKey: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);

  async function remove(id: string) {
    const result = await deleteFxRateAction(id);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success("FX rate deleted");
    router.refresh();
  }

  const add = () => setDraft({ date: todayKey, base: "USD", quote: baseCurrency, rate: "" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle>FX rates</CardTitle>
          <CardDescription>
            Accounts and holdings in other currencies convert to {baseCurrency} with the latest rate
            on or before each date. Without a rate they are left out of totals and marked “FX rate
            missing”.
          </CardDescription>
        </div>
        <Button onClick={add}>
          <Plus aria-hidden /> Add rate
        </Button>
      </CardHeader>
      <CardContent>
        {rates.length === 0 ? (
          <EmptyState
            title="No FX rates yet"
            description="Add a rate for each foreign currency you hold, e.g. 1 USD = 300 LKR."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Pair</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.date}</TableCell>
                  <TableCell>
                    1 {r.base} → {r.quote}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.rate}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${r.base}/${r.quote} on ${r.date}`}
                      onClick={() =>
                        setDraft({
                          id: r.id,
                          date: r.date,
                          base: r.base,
                          quote: r.quote,
                          rate: String(r.rate),
                        })
                      }
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${r.base}/${r.quote} on ${r.date}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      }
                      title="Delete this rate?"
                      description={`1 ${r.base} = ${r.rate} ${r.quote} on ${r.date}. Totals on and after that date use the previous rate, or leave amounts out if there is none.`}
                      confirmLabel="Delete"
                      destructive
                      onConfirm={() => remove(r.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {draft ? <RateDialog draft={draft} onClose={() => setDraft(null)} /> : null}
    </Card>
  );
}
