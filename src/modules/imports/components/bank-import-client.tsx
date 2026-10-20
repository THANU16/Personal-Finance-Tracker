"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DATE_FORMATS, type BankMapping } from "@/domain/bank-import";
import { cn } from "@/lib/utils";
import {
  analyzeBankCsvAction,
  commitBankImportAction,
  previewBankImportAction,
  undoBankImportAction,
} from "@/modules/imports/bank-actions";
import type {
  BankAnalysis,
  BankImportItem,
  BankImportResult,
  BankPreview,
} from "@/modules/imports/bank-service";

const MAX_FILE_BYTES = 900_000;
const NONE = "__none";

function ColumnSelect({
  id,
  label,
  headers,
  value,
  onChange,
  optional = false,
}: {
  id: string;
  label: string;
  headers: string[];
  value: number | null;
  onChange: (v: number | null) => void;
  optional?: boolean;
}) {
  const items = [
    ...(optional ? [{ value: NONE, label: "None" }] : []),
    ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
  ];
  return (
    <FormField id={id} label={label}>
      <Select
        value={value === null ? NONE : String(value)}
        onValueChange={(v) => onChange(v === NONE || v === null ? null : Number(v))}
        items={items}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose a column" />
        </SelectTrigger>
        <SelectContent>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

interface FileState {
  fileName: string;
  csvText: string;
}

/** Bank statement CSV: upload → map columns → preview (rules, duplicates) → import → undo. */
export function BankImportClient() {
  const router = useRouter();
  const [file, setFile] = useState<FileState | null>(null);
  const [analysis, setAnalysis] = useState<BankAnalysis | null>(null);
  const [mapping, setMapping] = useState<BankMapping | null>(null);
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [categories, setCategories] = useState<Record<number, string>>({});
  const [result, setResult] = useState<BankImportResult | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setFile(null);
    setAnalysis(null);
    setMapping(null);
    setPreview(null);
    setSkip(new Set());
    setCategories({});
    setResult(null);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      toast.error("The file is larger than 900 KB; split it by date range");
      return;
    }
    const csvText = await f.text();
    start(async () => {
      const res = await analyzeBankCsvAction({ fileName: f.name, csvText });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      reset();
      setFile({ fileName: f.name, csvText });
      setAnalysis(res.data);
      setMapping(res.data.mapping);
      setAccountId(res.data.accountId ?? "");
    });
  }

  const set = (patch: Partial<BankMapping>) => {
    setMapping((m) => (m ? { ...m, ...patch } : m));
    setPreview(null);
  };

  function runPreview() {
    if (!file || !mapping) return;
    start(async () => {
      const res = await previewBankImportAction({ ...file, accountId, mapping });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setPreview(res.data);
      setSkip(new Set());
      setCategories({});
    });
  }

  function commit() {
    if (!file || !mapping || !preview) return;
    const choices = preview.rows
      .filter((r) => !r.duplicate)
      .flatMap((r): { line: number; skip?: boolean; categoryId?: string }[] =>
        skip.has(r.line)
          ? [{ line: r.line, skip: true }]
          : categories[r.line]
            ? [{ line: r.line, categoryId: categories[r.line] }]
            : [],
      );
    start(async () => {
      const res = await commitBankImportAction({ ...file, accountId, mapping, choices });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setResult(res.data);
      toast.success(`${res.data.imported} transactions imported`);
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="grid gap-3 text-sm" role="status">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> {result.imported}{" "}
          transactions imported
          {result.duplicates ? ` · ${result.duplicates} already imported` : ""}
          {result.skipped ? ` · ${result.skipped} skipped` : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href="/transactions" />}>
            View transactions
          </Button>
          <Button variant="ghost" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  if (!analysis || !mapping || !file) {
    return (
      <div className="grid gap-2">
        <Label htmlFor="bank-csv">Statement file (.csv)</Label>
        <Input
          id="bank-csv"
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <p className="text-xs text-muted-foreground">
          Most banks export a CSV with a date, a description and either one amount column or
          separate debit and credit columns. Up to 900 KB.
        </p>
      </div>
    );
  }

  const account = analysis.accounts.find((a) => a.id === accountId);
  const fresh = preview?.rows.filter((r) => !r.duplicate) ?? [];
  const toImport = fresh.filter((r) => !skip.has(r.line));
  const missing = toImport.filter((r) => !(categories[r.line] ?? r.categoryId)).length;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{file.fileName}</span> · {analysis.rows} rows
        </span>
        <Button variant="ghost" size="sm" onClick={reset}>
          Choose another file
        </Button>
      </div>

      <section aria-labelledby="bank-map" className="grid gap-3">
        <h3 id="bank-map" className="font-medium">
          1. Map the columns
        </h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <caption className="sr-only">First rows of the file</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {analysis.headers.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="px-2 py-1.5 text-left font-medium whitespace-nowrap"
                  >
                    {i + 1}. {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.sample.slice(0, 4).map((r, i) => (
                <tr key={i} className="border-t">
                  {analysis.headers.map((_, j) => (
                    <td key={j} className="max-w-48 truncate px-2 py-1">
                      {r[j]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField id="bank-account" label="Import into">
            <Select
              value={accountId}
              onValueChange={(v) => {
                setAccountId(String(v ?? ""));
                setPreview(null);
              }}
              items={analysis.accounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.currency})`,
              }))}
            >
              <SelectTrigger id="bank-account" className="w-full">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {analysis.accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <ColumnSelect
            id="bank-date"
            label="Date column"
            headers={analysis.headers}
            value={mapping.dateColumn}
            onChange={(v) => set({ dateColumn: v ?? 0 })}
          />
          <FormField id="bank-date-format" label="Date format">
            <Select
              value={mapping.dateFormat}
              onValueChange={(v) => set({ dateFormat: v as BankMapping["dateFormat"] })}
              items={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
            >
              <SelectTrigger id="bank-date-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <ColumnSelect
            id="bank-desc"
            label="Description column"
            headers={analysis.headers}
            value={mapping.descriptionColumn}
            onChange={(v) => set({ descriptionColumn: v ?? 0 })}
          />
          <ColumnSelect
            id="bank-cp"
            label="Payee column (optional)"
            headers={analysis.headers}
            value={mapping.counterpartyColumn}
            onChange={(v) => set({ counterpartyColumn: v })}
            optional
          />
          <FormField id="bank-mode" label="Amounts">
            <Select
              value={mapping.amountMode}
              onValueChange={(v) =>
                set(
                  v === "signed"
                    ? {
                        amountMode: "signed",
                        amountColumn: mapping.amountColumn ?? mapping.debitColumn ?? 0,
                      }
                    : {
                        amountMode: "debit_credit",
                        debitColumn: mapping.debitColumn ?? 0,
                        creditColumn: mapping.creditColumn ?? 0,
                      },
                )
              }
              items={[
                { value: "signed", label: "One column (+ in, − out)" },
                { value: "debit_credit", label: "Debit and credit columns" },
              ]}
            >
              <SelectTrigger id="bank-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="signed">One column (+ in, − out)</SelectItem>
                <SelectItem value="debit_credit">Debit and credit columns</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {mapping.amountMode === "signed" ? (
            <ColumnSelect
              id="bank-amount"
              label="Amount column"
              headers={analysis.headers}
              value={mapping.amountColumn}
              onChange={(v) => set({ amountColumn: v })}
            />
          ) : (
            <>
              <ColumnSelect
                id="bank-debit"
                label="Debit (money out) column"
                headers={analysis.headers}
                value={mapping.debitColumn}
                onChange={(v) => set({ debitColumn: v })}
              />
              <ColumnSelect
                id="bank-credit"
                label="Credit (money in) column"
                headers={analysis.headers}
                value={mapping.creditColumn}
                onChange={(v) => set({ creditColumn: v })}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={mapping.hasHeader} onCheckedChange={(v) => set({ hasHeader: v })} />
            First row is a header
          </label>
          {mapping.amountMode === "signed" ? (
            <label className="flex items-center gap-2">
              <Switch checked={mapping.negate} onCheckedChange={(v) => set({ negate: v })} />
              Spending is shown as positive
            </label>
          ) : null}
        </div>
        <div>
          <Button onClick={runPreview} disabled={pending || !accountId}>
            {pending && !preview ? "Reading…" : "Preview"}
          </Button>
        </div>
      </section>

      {preview ? (
        <section aria-labelledby="bank-preview" className="grid gap-3">
          <h3 id="bank-preview" className="font-medium">
            2. Check the rows
          </h3>
          <p className="text-sm text-muted-foreground">
            {fresh.length} new · {preview.totals.duplicates} already imported (greyed out) · in{" "}
            <Money valueMinor={preview.totals.inMinor} currency={preview.currency} /> · out{" "}
            <Money valueMinor={preview.totals.outMinor} currency={preview.currency} />. Categories
            come from your rules (Settings → Categories); change any row below.
          </p>
          {preview.errors.length ? (
            <details className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
              <summary>
                {preview.errors.length} lines can&apos;t be read and will be skipped
              </summary>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {preview.errors.slice(0, 50).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="max-h-[32rem] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Rows to import</caption>
              <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium">
                    <span className="sr-only">Import</span>
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Description
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Category
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const kind = r.amountMinor > 0 ? "income" : "expense";
                  const chosen = categories[r.line] ?? r.categoryId ?? "";
                  return (
                    <tr
                      key={r.line}
                      className={cn(
                        "border-t",
                        (r.duplicate || skip.has(r.line)) && "text-muted-foreground",
                      )}
                    >
                      <td className="px-2 py-1.5 text-center">
                        {r.duplicate ? (
                          <Badge variant="outline">Imported</Badge>
                        ) : (
                          <Checkbox
                            aria-label={`Import line ${r.line}`}
                            checked={!skip.has(r.line)}
                            onCheckedChange={(v) =>
                              setSkip((s) => {
                                const next = new Set(s);
                                if (v) next.delete(r.line);
                                else next.add(r.line);
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {format(parseISO(r.date), "d MMM yyyy")}
                      </td>
                      <td className="max-w-72 px-2 py-1.5">
                        <span className="line-clamp-2">{r.description}</span>
                        {r.counterparty ? (
                          <span className="block text-xs text-muted-foreground">
                            {r.counterparty}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                        <Money valueMinor={r.amountMinor} currency={preview.currency} signed />
                      </td>
                      <td className="px-2 py-1.5">
                        {r.duplicate ? null : (
                          <select
                            aria-label={`Category for line ${r.line}`}
                            className="h-8 w-full min-w-40 rounded-md border bg-background px-2 text-sm"
                            value={chosen}
                            disabled={skip.has(r.line)}
                            onChange={(e) =>
                              setCategories((c) => ({ ...c, [r.line]: e.target.value }))
                            }
                          >
                            {!chosen ? <option value="">Choose…</option> : null}
                            {preview.categories
                              .filter((c) => c.kind === kind)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                          </select>
                        )}
                        {!r.duplicate && r.ruleId && !categories[r.line] ? (
                          <span className="text-xs text-muted-foreground">by rule</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={commit} disabled={pending || toImport.length === 0 || missing > 0}>
              {pending
                ? "Importing…"
                : `Import ${toImport.length} transactions into ${account?.name ?? "the account"}`}
            </Button>
            {missing ? (
              <span className="text-sm text-destructive">
                Choose a category for {missing} rows.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function BankImportHistory({ items }: { items: BankImportItem[] }) {
  const router = useRouter();
  if (!items.length)
    return <p className="text-sm text-muted-foreground">No bank statement imports yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {items.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="min-w-0">
            <span className="font-medium">{b.fileName}</span> → {b.accountName}
            <span className="block text-xs text-muted-foreground">
              {format(parseISO(b.createdAt), "d MMM yyyy")} · {b.transactions} transactions
              {b.from && b.to ? ` · ${b.from} to ${b.to}` : ""}
            </span>
          </span>
          {b.status === "imported" ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Undo2 aria-hidden /> Undo
                </Button>
              }
              title={`Undo ${b.fileName}?`}
              description={`Voids the ${b.transactions} transactions this import posted into ${b.accountName} and restores the balance. The same file can be imported again.`}
              confirmLabel="Undo import"
              destructive
              onConfirm={async () => {
                const res = await undoBankImportAction(b.id);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return false;
                }
                toast.success(`${res.data.voided} transactions voided`);
                router.refresh();
              }}
            />
          ) : (
            <Badge variant="secondary">Undone</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
