"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, FileSpreadsheet, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { PercentInput } from "@/components/shared/percent-input";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DEFAULT_JUMP_THRESHOLD_BP,
  bigChanges,
  buildImportPlan,
  dayEnds,
  detectJumps,
  orderRows,
  simulateImport,
  type JumpAction,
  type JumpChoice,
} from "@/domain/valuation-import";
import { formatPercentBp } from "@/lib/format";
import { stackOnPhone } from "@/components/shared/mobile/stack-table";
import { cn } from "@/lib/utils";
import { INSTRUMENT_LABEL, instrumentsForClass } from "@/modules/holdings/components/holding-meta";
import type { InstrumentType } from "@/modules/holdings/constants";
import {
  analyzeValuationFileAction,
  commitValuationImportAction,
  rebuildAfterImportAction,
  undoValuationImportAction,
} from "@/modules/imports/valuation-actions";
import type {
  ValuationImportAnalysis,
  ValuationImportResult,
} from "@/modules/imports/valuation-service";

const NEW_HOLDING = "__new";
const EXTERNAL = "__external";
const MAX_FILE_BYTES = 900_000;

interface FileState {
  id: string;
  fileName: string;
  csvText: string;
  analysis: ValuationImportAnalysis;
}

function Pick({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={options}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ImportCard({ file, onRemove }: { file: FileState; onRemove: () => void }) {
  const [analysis, setAnalysis] = useState(file.analysis);
  const a = analysis;
  const [holdingChoice, setHoldingChoice] = useState(a.holding?.id ?? NEW_HOLDING);
  const [newHolding, setNewHolding] = useState({
    name: a.assetName,
    assetClassId: a.options.assetClasses[0]?.id ?? "",
    instrumentType: "unit_trust" as InstrumentType,
  });
  const [funding, setFunding] = useState(EXTERNAL);
  const [firstAsInvestment, setFirstAsInvestment] = useState(true);
  const [thresholdBp, setThresholdBp] = useState<number | null>(DEFAULT_JUMP_THRESHOLD_BP);
  const [choices, setChoices] = useState<Record<string, JumpChoice>>({});
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<ValuationImportResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [pending, start] = useTransition();

  // Re-analyse when the holding changes (duplicates, currency, existing flows depend on it).
  function chooseHolding(id: string) {
    setHoldingChoice(id);
    setChoices({});
    start(async () => {
      const res = await analyzeValuationFileAction({
        fileName: file.fileName,
        csvText: file.csvText,
        holdingId: id === NEW_HOLDING ? null : id,
      });
      if (!res.ok) toast.error(res.error.message);
      else setAnalysis(res.data);
    });
  }

  const currency =
    a.holding?.currency ?? a.rows.find((r) => !r.errors.length)?.currency ?? a.baseCurrency;
  const trackUnits = a.holding?.trackUnits ?? false;
  const dup = useMemo(() => new Set(a.duplicateLines), [a.duplicateLines]);
  const valid = a.rows.filter((r) => !r.errors.length);
  const fresh = valid.filter((r) => !dup.has(r.line));
  const ordered = orderRows(a.rows);
  const days = dayEnds(orderRows(valid));
  const jumps = detectJumps(days, {
    thresholdBp: thresholdBp && thresholdBp > 0 ? thresholdBp : DEFAULT_JUMP_THRESHOLD_BP,
    currency,
    existingFlows: a.holding?.existingFlows ?? [],
    newDates: new Set(fresh.map((r) => r.date)),
  });
  const choiceOf = (key: string) => {
    const j = jumps.find((x) => x.key === key)!;
    return choices[key] ?? { action: j.action, amountMinor: j.amountMinor, date: j.date };
  };
  const canFirst = !a.holding?.hasInitialTransactions;
  const plan = buildImportPlan({
    rows: fresh,
    jumps,
    choices: Object.fromEntries(jumps.map((j) => [j.key, choiceOf(j.key)])),
    firstAsInvestment: firstAsInvestment && canFirst,
    trackUnits,
  });
  const summary = simulateImport({
    existing: a.holding?.existingEvents ?? [],
    plan,
    trackUnits,
    todayKey: a.todayKey,
  });
  const big = bigChanges(days, 2000);
  const lastOfDay = new Map(days.map((d) => [d.date, d.lines.at(-1)]));
  const jumpByDate = new Map(jumps.map((j) => [j.toDate, j]));
  const prevDay = new Map(days.map((d, i) => [d.date, i > 0 ? days[i - 1]!.valueMinor : null]));
  const fundingOptions = [
    { value: EXTERNAL, label: "Historical funding (external): create / reuse" },
    ...a.options.accounts
      .filter((x) => x.currency === currency)
      .map((x) => ({ value: x.id, label: `${x.name} · opened ${x.openingDate}` })),
  ];
  const errors = a.rows.filter((r) => r.errors.length).length;

  function commit() {
    start(async () => {
      const res = await commitValuationImportAction({
        fileName: file.fileName,
        csvText: file.csvText,
        holding:
          holdingChoice === NEW_HOLDING
            ? {
                create: {
                  name: newHolding.name,
                  assetClassId: newHolding.assetClassId,
                  instrumentType: newHolding.instrumentType,
                  liquidity: "medium",
                },
              }
            : { existingId: holdingChoice },
        funding: plan.flows.length
          ? funding === EXTERNAL
            ? { createExternal: true }
            : { existingId: funding }
          : null,
        firstAsInvestment: firstAsInvestment && canFirst,
        thresholdBp: thresholdBp ?? DEFAULT_JUMP_THRESHOLD_BP,
        choices: Object.fromEntries(jumps.map((j) => [j.key, choiceOf(j.key)])),
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`${res.data.valuations} values imported`);
      setResult(res.data);
    });
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-primary" aria-hidden />{" "}
            {undone ? "Import undone" : "Import complete"}
          </CardTitle>
          <CardDescription>{file.fileName}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {undone ? (
            <p>
              The values were removed and the transactions voided; the holding and the account are
              back as before.
            </p>
          ) : (
            <>
              <p>
                {result.valuations} values, {result.deposits} deposits and {result.withdrawals}{" "}
                withdrawals imported
                {result.duplicates ? `; ${result.duplicates} duplicates skipped` : ""}
                {result.errors ? `; ${result.errors} rows with errors skipped` : ""}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/assets/${result.holdingId}`} className={buttonVariants()}>
                  Open holding
                </Link>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await rebuildAfterImportAction();
                      if (!res.ok) toast.error(res.error.message);
                      else toast.success(`Net-worth history rebuilt (${res.data.months} months)`);
                    })
                  }
                >
                  Rebuild net-worth history
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="destructive">
                      <Undo2 aria-hidden /> Undo import
                    </Button>
                  }
                  title="Undo this import?"
                  description={`Removes the ${result.valuations} imported values and voids ${result.deposits + result.withdrawals} transactions, then recalculates the holding and the funding account.`}
                  confirmLabel="Undo import"
                  destructive
                  onConfirm={async () => {
                    const res = await undoValuationImportAction(result.batchId);
                    if (!res.ok) {
                      toast.error(res.error.message);
                      return false;
                    }
                    toast.success("Import undone");
                    setUndone(true);
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`import-card-${a.assetName}`}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden /> {a.assetName}
          </CardTitle>
          <CardDescription>
            {file.fileName} · {a.rows.length} rows
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {a.fileError ? (
          <p role="alert" className="text-sm text-destructive">
            {a.fileError}
          </p>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FormField id={`${file.id}-holding`} label="Holding">
            <Pick
              id={`${file.id}-holding`}
              value={holdingChoice}
              onChange={chooseHolding}
              options={[
                { value: NEW_HOLDING, label: "Create a new holding" },
                ...a.options.holdings
                  .filter((h) => !h.isFd)
                  .map((h) => ({
                    value: h.id,
                    label: `${h.name}${h.id === a.suggestedHoldingId ? " (suggested)" : ""}`,
                  })),
              ]}
            />
          </FormField>
          <FormField
            id={`${file.id}-funding`}
            label="Funding account"
            description="Where deposits come from and withdrawals go"
          >
            <Pick
              id={`${file.id}-funding`}
              value={funding}
              onChange={setFunding}
              options={fundingOptions}
            />
          </FormField>
          <FormField
            id={`${file.id}-threshold`}
            label="Flag jumps of at least"
            description="Or a whole multiple of 1,000"
          >
            <PercentInput
              id={`${file.id}-threshold`}
              value={thresholdBp}
              onChange={setThresholdBp}
            />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor={`${file.id}-first`} className="text-sm">
              First value = initial investment
              {!canFirst ? (
                <span className="block text-xs text-muted-foreground">
                  The holding already has investments
                </span>
              ) : null}
            </Label>
            <Switch
              id={`${file.id}-first`}
              checked={firstAsInvestment && canFirst}
              disabled={!canFirst}
              onCheckedChange={setFirstAsInvestment}
            />
          </div>
        </div>
        {holdingChoice === NEW_HOLDING ? (
          <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-3">
            <FormField id={`${file.id}-new-name`} label="New holding name">
              <Input
                id={`${file.id}-new-name`}
                value={newHolding.name}
                onChange={(e) => setNewHolding((h) => ({ ...h, name: e.target.value }))}
              />
            </FormField>
            <FormField id={`${file.id}-new-class`} label="Asset class">
              <Pick
                id={`${file.id}-new-class`}
                value={newHolding.assetClassId}
                onChange={(v) => {
                  const types = instrumentsForClass(
                    a.options.assetClasses.find((c) => c.id === v)?.name,
                  ).filter((t) => t !== "fd");
                  setNewHolding((h) => ({
                    ...h,
                    assetClassId: v,
                    instrumentType: (types as InstrumentType[]).includes(h.instrumentType)
                      ? h.instrumentType
                      : types[0]!,
                  }));
                }}
                options={a.options.assetClasses.map((c) => ({ value: c.id, label: c.name }))}
              />
            </FormField>
            <FormField id={`${file.id}-new-type`} label="Instrument">
              <Pick
                id={`${file.id}-new-type`}
                value={newHolding.instrumentType}
                onChange={(v) =>
                  setNewHolding((h) => ({ ...h, instrumentType: v as InstrumentType }))
                }
                options={instrumentsForClass(
                  a.options.assetClasses.find((c) => c.id === newHolding.assetClassId)?.name,
                )
                  .filter((t) => t !== "fd")
                  .map((t) => ({ value: t, label: INSTRUMENT_LABEL[t] }))}
              />
            </FormField>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="overflow-x-auto rounded-lg border max-md:px-3">
            <table className={cn("w-full text-sm", stackOnPhone)}>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Recorded at</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => {
                  const isDup = dup.has(r.line);
                  const superseded = !r.errors.length && lastOfDay.get(r.date) !== r.line;
                  const dayValue = !r.errors.length && lastOfDay.get(r.date) === r.line;
                  const prev = prevDay.get(r.date);
                  const change =
                    dayValue && prev !== null && prev !== undefined ? r.valueMinor - prev : null;
                  const jump = dayValue ? jumpByDate.get(r.date) : undefined;
                  const c = jump ? choiceOf(jump.key) : null;
                  return (
                    <tr
                      key={r.line}
                      className={cn(
                        "border-t align-top",
                        (superseded || isDup) && "text-muted-foreground",
                        r.errors.length && "bg-destructive/5",
                      )}
                      data-testid={`row-${r.line}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.date}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                        {r.recordedAt?.replace("T", " ").replace("Z", "") ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money valueMinor={r.valueMinor} currency={r.currency} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {change !== null ? (
                          <Money valueMinor={change} currency={r.currency} signed />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.errors.length ? (
                            <Badge variant="destructive">Error: {r.errors.join("; ")}</Badge>
                          ) : null}
                          {isDup ? <Badge variant="outline">Duplicate</Badge> : null}
                          {superseded ? <Badge variant="outline">Same day</Badge> : null}
                          {dayValue && big.has(r.date) ? (
                            <Badge variant="secondary">Big change</Badge>
                          ) : null}
                          {jump?.alreadyRecorded ? (
                            <Badge variant="outline">Already recorded</Badge>
                          ) : null}
                        </div>
                        {jump && c ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_9rem_10rem]">
                            <Pick
                              id={`${file.id}-jump-${jump.key}`}
                              value={c.action}
                              onChange={(v) =>
                                setChoices((s) => ({
                                  ...s,
                                  [jump.key]: { ...c, action: v as JumpAction },
                                }))
                              }
                              options={[
                                { value: "deposit", label: "Deposit" },
                                { value: "withdrawal", label: "Withdrawal" },
                                { value: "market", label: "Market move" },
                              ]}
                            />
                            {c.action !== "market" ? (
                              <>
                                <MoneyInput
                                  aria-label={`Amount for ${jump.key}`}
                                  currency={r.currency}
                                  value={c.amountMinor}
                                  onChange={(v) =>
                                    setChoices((s) => ({
                                      ...s,
                                      [jump.key]: {
                                        ...c,
                                        amountMinor: v && !Number.isNaN(v) ? v : 0,
                                      },
                                    }))
                                  }
                                />
                                <DatePicker
                                  value={c.date}
                                  onChange={(v) =>
                                    v &&
                                    setChoices((s) => ({ ...s, [jump.key]: { ...c, date: v } }))
                                  }
                                />
                              </>
                            ) : null}
                            {jump.stepsMinor.length > 1 ? (
                              <p className="text-xs text-muted-foreground sm:col-span-3">
                                Same-day steps:{" "}
                                {jump.stepsMinor
                                  .map((sv) => (sv > 0 ? "+" : "") + (sv / 100).toLocaleString())
                                  .join(", ")}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside className="space-y-3 rounded-lg border p-4 text-sm" aria-label="Import summary">
            <h3 className="font-medium">Summary</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <dt>Rows to import</dt>
              <dd className="text-right tabular-nums">{plan.valuations.length}</dd>
              <dt>Duplicates</dt>
              <dd className="text-right tabular-nums">{dup.size}</dd>
              <dt>Errors</dt>
              <dd className="text-right tabular-nums">{errors}</dd>
              <dt>Deposits</dt>
              <dd className="text-right">
                <Money valueMinor={plan.depositMinor} currency={currency} />
              </dd>
              <dt>Withdrawals</dt>
              <dd className="text-right">
                <Money valueMinor={plan.withdrawalMinor} currency={currency} />
              </dd>
            </dl>
            <dl
              className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-3"
              aria-live="polite"
            >
              <dt>Invested</dt>
              <dd className="text-right" data-testid="summary-invested">
                <Money valueMinor={summary.investedMinor} currency={currency} />
              </dd>
              <dt>Current value</dt>
              <dd className="text-right" data-testid="summary-value">
                <Money valueMinor={summary.currentValueMinor} currency={currency} />
              </dd>
              <dt>Unrealised gain</dt>
              <dd className="text-right">
                <Money valueMinor={summary.unrealisedMinor} currency={currency} signed />
              </dd>
              <dt>XIRR</dt>
              <dd className="text-right">
                {summary.xirrBp === null ? "—" : formatPercentBp(summary.xirrBp)}
              </dd>
            </dl>
            <label className="flex items-start gap-2 border-t pt-3">
              <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
              <span>I checked the jumps</span>
            </label>
            <Button
              className="w-full"
              disabled={!reviewed || pending || !plan.valuations.length || Boolean(a.fileError)}
              onClick={commit}
            >
              {pending ? "Working…" : `Import ${plan.valuations.length} values`}
            </Button>
          </aside>
        </div>
      </CardContent>
    </Card>
  );
}

/** docs/05 — /assets/import-valuations: one card per uploaded CSV. */
export function ValuationImportClient({ holdingId }: { holdingId: string | null }) {
  const [files, setFiles] = useState<FileState[]>([]);
  const [pending, start] = useTransition();

  function onFiles(list: FileList | null) {
    const chosen = [...(list ?? [])];
    start(async () => {
      for (const f of chosen) {
        if (!/\.csv$/i.test(f.name)) {
          toast.error(`${f.name} is not a .csv file`);
          continue;
        }
        if (f.size > MAX_FILE_BYTES) {
          toast.error(`${f.name} is larger than 900 KB`);
          continue;
        }
        const csvText = await f.text();
        let res = await analyzeValuationFileAction({ fileName: f.name, csvText, holdingId });
        // Load the holding suggested from the file name (the user can change it).
        if (res.ok && !holdingId && res.data.suggestedHoldingId) {
          res = await analyzeValuationFileAction({
            fileName: f.name,
            csvText,
            holdingId: res.data.suggestedHoldingId,
          });
        }
        if (!res.ok) {
          toast.error(`${f.name}: ${res.error.message}`);
          continue;
        }
        setFiles((s) => [
          ...s,
          { id: `${Date.now()}-${s.length}`, fileName: f.name, csvText, analysis: res.data },
        ]);
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>
            One CSV per asset, exported as “&lt;Asset&gt; - valuations &lt;date&gt;.csv”. Nothing is
            saved until you import a card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="valuation-files" className="mb-2 block">
            Valuation CSV files
          </Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="valuation-files"
              type="file"
              accept=".csv,text/csv"
              multiple
              className="max-w-md"
              onChange={(e) => onFiles(e.target.files)}
            />
            {pending ? (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Upload className="size-4" aria-hidden /> Reading…
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {files.map((f) => (
        <ImportCard
          key={f.id}
          file={f}
          onRemove={() => setFiles((s) => s.filter((x) => x.id !== f.id))}
        />
      ))}
    </div>
  );
}
