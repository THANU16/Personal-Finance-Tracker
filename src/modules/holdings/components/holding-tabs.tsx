"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { ArrowDownToLine, ArrowUpFromLine, Coins, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { formatMoney, formatPrice, formatUnits } from "@/lib/format";
import {
  closeHoldingAction,
  deleteValuationAction,
  reopenHoldingAction,
  updateHoldingAction,
} from "@/modules/holdings/actions";
import { LIQUIDITY_LABEL } from "@/modules/holdings/components/holding-meta";
import { ValuationDialog } from "@/modules/holdings/components/valuation-dialog";
import { LIQUIDITY, type Liquidity } from "@/modules/holdings/constants";
import type { HoldingDTO, ValuationDTO } from "@/modules/holdings/schemas";
import { useQuickAdd } from "@/modules/transactions/components/quick-add-context";
import { TransactionsTable } from "@/modules/transactions/components/transactions-table";
import type { TransactionDTO } from "@/modules/transactions/schemas";

const day = (key: string) => format(parse(key, "yyyy-MM-dd", new Date(2000, 0, 1)), "d MMM yyyy");

const SOURCE_LABEL: Record<ValuationDTO["source"], string> = {
  manual: "Manual",
  auto_on_buy: "On buy",
  auto_on_redeem: "On redeem",
  fd_calc: "FD calc",
  bulk: "Bulk update",
  price_feed: "Price feed",
};

/** Header actions: Buy · Redeem · Record income · Update value. */
export function HoldingHeaderActions({
  holding,
  todayKey,
  bigChangeThresholdBp,
}: {
  holding: HoldingDTO;
  todayKey: string;
  bigChangeThresholdBp: number;
}) {
  const { open } = useQuickAdd();
  const [valuing, setValuing] = React.useState(false);
  if (holding.status !== "active") return null;
  return (
    <>
      <Button onClick={() => open({ mode: "create", type: "invest", holdingId: holding.id })}>
        <ArrowDownToLine aria-hidden /> Buy
      </Button>
      <Button
        variant="outline"
        onClick={() => open({ mode: "create", type: "redeem", holdingId: holding.id })}
      >
        <ArrowUpFromLine aria-hidden /> Redeem
      </Button>
      <Button
        variant="outline"
        onClick={() => open({ mode: "create", type: "investment_income", holdingId: holding.id })}
      >
        <Coins aria-hidden /> Income
      </Button>
      {!holding.fd ? (
        <>
          <Button variant="outline" onClick={() => setValuing(true)}>
            <RefreshCw aria-hidden /> Update value
          </Button>
          <ValuationDialog
            holding={holding}
            open={valuing}
            onOpenChange={setValuing}
            todayKey={todayKey}
            bigChangeThresholdBp={bigChangeThresholdBp}
          />
        </>
      ) : null}
    </>
  );
}

function ValuationsTable({
  holding,
  valuations,
}: {
  holding: HoldingDTO;
  valuations: ValuationDTO[];
}) {
  const router = useRouter();
  if (holding.fd) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Fixed deposit values are calculated from the deposit terms.
      </p>
    );
  }
  if (!valuations.length) {
    return (
      <EmptyState
        title="No valuations yet"
        description="Use Update value whenever you check the holding's worth."
      />
    );
  }
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Value</TableHead>
            {holding.trackUnits ? <TableHead className="text-right">Price</TableHead> : null}
            {holding.trackUnits ? <TableHead className="text-right">Units</TableHead> : null}
            <TableHead>Source</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {valuations.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="text-muted-foreground tabular-nums">{day(v.date)}</TableCell>
              <TableCell className="text-right">
                <Money valueMinor={v.valueMinor} currency={holding.currency} />
              </TableCell>
              {holding.trackUnits ? (
                <TableCell className="text-right tabular-nums" data-money="">
                  {v.priceMinorE4 ? formatPrice(v.priceMinorE4, holding.currency) : "—"}
                </TableCell>
              ) : null}
              {holding.trackUnits ? (
                <TableCell className="text-right tabular-nums">
                  {v.units !== null ? formatUnits(v.units) : "—"}
                </TableCell>
              ) : null}
              <TableCell>
                <Badge variant="outline">{SOURCE_LABEL[v.source]}</Badge>
                {v.note ? (
                  <span className="ml-2 text-xs text-muted-foreground">{v.note}</span>
                ) : null}
              </TableCell>
              <TableCell>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete valuation of ${day(v.date)}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  }
                  title="Delete this valuation?"
                  description={`Removes the ${formatMoney(v.valueMinor, holding.currency)} value recorded on ${day(v.date)}. The holding's value is recalculated from the remaining history.`}
                  confirmLabel="Delete"
                  destructive
                  onConfirm={async () => {
                    const result = await deleteValuationAction(holding.id, v.id);
                    if (!result.ok) {
                      toast.error(result.error.message);
                      return false;
                    }
                    toast.success("Valuation deleted");
                    router.refresh();
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DetailsForm({
  holding,
  classes,
}: {
  holding: HoldingDTO;
  classes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState(holding.name);
  const [assetClassId, setAssetClassId] = React.useState(holding.assetClass.id);
  const [platform, setPlatform] = React.useState(holding.platform ?? "");
  const [symbol, setSymbol] = React.useState(holding.symbol ?? "");
  const [liquidity, setLiquidity] = React.useState<Liquidity>(holding.liquidity);
  const [tags, setTags] = React.useState(holding.tags.join(", "));
  const [notes, setNotes] = React.useState(holding.notes ?? "");
  const [trackUnits, setTrackUnits] = React.useState(holding.trackUnits);
  const [emergency, setEmergency] = React.useState(holding.countsTowardEmergencyFund);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await updateHoldingAction(holding.id, {
      name,
      assetClassId,
      platform,
      symbol,
      liquidity,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes,
      countsTowardEmergencyFund: emergency,
      ...(holding.fd ? {} : { trackUnits }),
    });
    setPending(false);
    if (!result.ok) {
      setErrors(
        Object.fromEntries(
          Object.entries(result.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""]),
        ),
      );
      toast.error(result.error.message);
      return;
    }
    setErrors({});
    toast.success("Holding updated");
    router.refresh();
  }

  async function close() {
    const result = await closeHoldingAction(holding.id, { force: true });
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success(`${holding.name} closed`);
    router.refresh();
  }

  async function reopen() {
    const result = await reopenHoldingAction(holding.id);
    if (!result.ok) toast.error(result.error.message);
    else {
      toast.success(`${holding.name} reopened`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} noValidate className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormField id="d-name" label="Name" error={errors.name}>
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
      </div>
      <FormField id="d-class" label="Asset class" error={errors.assetClassId}>
        <Select
          value={assetClassId}
          onValueChange={(v) => setAssetClassId(String(v))}
          items={classes.map((c) => ({ value: c.id, label: c.name }))}
        >
          <SelectTrigger id="d-class" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="d-liquidity" label="Liquidity">
        <Select
          value={liquidity}
          onValueChange={(v) => setLiquidity(v as Liquidity)}
          items={LIQUIDITY.map((l) => ({ value: l, label: LIQUIDITY_LABEL[l] }))}
        >
          <SelectTrigger id="d-liquidity" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIQUIDITY.map((l) => (
              <SelectItem key={l} value={l}>
                {LIQUIDITY_LABEL[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="d-platform" label="Platform / bank">
        <Input id="d-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} />
      </FormField>
      <FormField id="d-symbol" label="Symbol">
        <Input id="d-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="d-tags" label="Tags" description="Separate with commas.">
          <Input
            id="d-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            aria-describedby="d-tags-description"
          />
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField id="d-notes" label="Notes">
          <Textarea
            id="d-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
      </div>
      {!holding.fd ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
          <Label htmlFor="d-track">
            Track units and price
            <span className="block text-xs font-normal text-muted-foreground">
              Value becomes units × latest price; redeem by units.
            </span>
          </Label>
          <Switch id="d-track" checked={trackUnits} onCheckedChange={setTrackUnits} />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
        <Label htmlFor="d-emergency">Counts toward emergency fund</Label>
        <Switch id="d-emergency" checked={emergency} onCheckedChange={setEmergency} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 sm:col-span-2">
        {holding.status === "active" ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline">
                Close holding
              </Button>
            }
            title={`Close ${holding.name}?`}
            description={
              holding.currentValueMinor === 0
                ? "It moves to closed holdings; its history stays."
                : `It is still worth ${formatMoney(holding.currentValueMinor, holding.currency)}. Closing removes that value from your portfolio and net worth; record a redemption instead if you sold it.`
            }
            confirmLabel="Close holding"
            destructive={holding.currentValueMinor !== 0}
            onConfirm={close}
          />
        ) : (
          <Button type="button" variant="outline" onClick={() => void reopen()}>
            Reopen holding
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}

export function HoldingTabs({
  holding,
  transactions,
  valuations,
  classes,
}: {
  holding: HoldingDTO;
  transactions: TransactionDTO[];
  valuations: ValuationDTO[];
  classes: { id: string; name: string }[];
}) {
  const income = transactions.filter((t) => t.type === "investment_income");
  return (
    <Tabs defaultValue="transactions">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="transactions">Transactions</TabsTrigger>
        <TabsTrigger value="valuations">Valuations</TabsTrigger>
        <TabsTrigger value="income">Income</TabsTrigger>
        <TabsTrigger value="details">Details</TabsTrigger>
      </TabsList>
      <TabsContent value="transactions" className="pt-4">
        {transactions.length ? (
          <TransactionsTable rows={transactions.map((txn) => ({ txn }))} />
        ) : (
          <EmptyState
            title="No transactions"
            description="Buys, redemptions and income for this holding appear here."
          />
        )}
      </TabsContent>
      <TabsContent value="valuations" className="pt-4">
        <ValuationsTable holding={holding} valuations={valuations} />
      </TabsContent>
      <TabsContent value="income" className="pt-4">
        {income.length ? (
          <TransactionsTable rows={income.map((txn) => ({ txn }))} />
        ) : (
          <EmptyState
            title="No income yet"
            description="Record dividends, interest, distributions or rent, paid out or reinvested."
          />
        )}
      </TabsContent>
      <TabsContent value="details" className="pt-4">
        <DetailsForm holding={holding} classes={classes} />
      </TabsContent>
    </Tabs>
  );
}
