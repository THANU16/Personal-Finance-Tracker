"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { commitImportAction, undoImportAction } from "@/modules/imports/actions";
import type { ImportResult, PreviewData, WizardData, WizardState } from "@/modules/imports/schemas";
import { stackOnPhone } from "@/components/shared/mobile/stack-table";

type SetState = React.Dispatch<React.SetStateAction<WizardState>>;

/** Step 6 — opening date and balance per target account (Money Manager starts from zero). */
export function OpeningsStep({
  data,
  preview,
  state,
  setState,
}: {
  data: WizardData;
  preview: PreviewData;
  state: WizardState;
  setState: SetState;
}) {
  const setOpening = (ref: string, patch: Partial<{ date: string | null; balanceMinor: number }>) =>
    setState((s) => {
      const prev = s.openings[ref] ?? { date: null, balanceMinor: 0 };
      return { ...s, openings: { ...s.openings, [ref]: { ...prev, ...patch } } };
    });

  return (
    <section aria-labelledby="openings-title" className="space-y-4">
      <div>
        <h2 id="openings-title" className="text-lg font-semibold">
          Opening balances
        </h2>
        <p className="text-sm text-muted-foreground">
          Money Manager starts every account at zero, so 0 keeps the balances identical. New
          accounts open on their first row. Holdings start empty; their first Difference row becomes
          the opening value.
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {preview.balances.map((line) => {
          const chosen = state.openings[line.ref];
          if (line.isNew) {
            return (
              <li
                key={line.ref}
                className="grid gap-2 p-3 sm:grid-cols-[1fr_12rem_12rem] sm:items-center"
              >
                <div>
                  <p className="font-medium">{line.name}</p>
                  <p className="text-xs text-muted-foreground">
                    New account · first row {line.firstDate}
                  </p>
                </div>
                <DatePicker
                  value={chosen?.date ?? line.firstDate}
                  onChange={(v) => setOpening(line.ref, { date: v })}
                  aria-invalid={Boolean(
                    chosen?.date && line.firstDate && chosen.date > line.firstDate,
                  )}
                />
                <MoneyInput
                  aria-label={`Opening balance for ${line.name}`}
                  currency={line.currency}
                  value={chosen?.balanceMinor ?? 0}
                  onChange={(v) =>
                    setOpening(line.ref, { balanceMinor: v && Number.isFinite(v) ? v : 0 })
                  }
                />
              </li>
            );
          }
          const older = line.firstDate && line.openingDate && line.firstDate < line.openingDate;
          const move = Boolean(chosen?.date);
          return (
            <li key={line.ref} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="font-medium">{line.name}</p>
                <p className="text-xs text-muted-foreground">
                  Existing account · opened {line.openingDate} · balance now{" "}
                  <Money valueMinor={line.openingBalanceMinor} currency={line.currency} /> opening
                </p>
              </div>
              {older ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={move}
                    onCheckedChange={(v) =>
                      setState((s) => {
                        const openings = { ...s.openings };
                        if (v === true)
                          openings[line.ref] = { date: line.firstDate, balanceMinor: 0 };
                        else delete openings[line.ref];
                        return { ...s, openings };
                      })
                    }
                  />
                  Move its opening date to {line.firstDate} (rows start earlier)
                </label>
              ) : (
                <p className="text-sm text-muted-foreground">Rows are added to its history.</p>
              )}
            </li>
          );
        })}
      </ul>
      {!preview.balances.length ? (
        <p className="text-sm text-muted-foreground">No accounts receive rows from this file.</p>
      ) : null}
      <p className="text-xs text-muted-foreground">Base currency {data.baseCurrency}.</p>
    </section>
  );
}

const OP_LABEL: Record<string, string> = {
  expense: "Expenses",
  income: "Incomes",
  transfer: "Transfers",
  invest: "Investments",
  redeem: "Redemptions",
  adjustment: "Balance adjustments",
  opening: "Holding opening values",
  valuation_difference: "Valuations (Difference rows)",
  valuation_before_redeem: "Valuations before a redemption",
};

/** Step 7 — dry run: what will be created, and WealthTrack's balances against Money Manager's. */
export function PreviewStep({
  data,
  preview,
  onImported,
}: {
  data: WizardData;
  preview: PreviewData;
  onImported: (r: ImportResult) => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [pending, start] = useTransition();
  const ccy = data.baseCurrency;
  const mismatches = preview.balances.filter((b) => b.wealthTrackMinor !== b.moneyManagerMinor);

  function commit() {
    start(async () => {
      const res = await commitImportAction({ batchId: data.batchId, confirmReviewed: true });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Imported ${res.data.transactions} transactions`);
      onImported(res.data);
    });
  }

  return (
    <section aria-labelledby="preview-title" className="space-y-6">
      <div>
        <h2 id="preview-title" className="text-lg font-semibold">
          Preview
        </h2>
        <p className="text-sm text-muted-foreground">
          Nothing is saved yet. Check the totals, then import.
        </p>
      </div>

      {preview.blockers.length ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm"
        >
          <p className="font-medium text-destructive">Fix these before importing</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <ul className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h3 className="font-medium">Will be created</h3>
          <dl className="mt-2 space-y-1 text-sm">
            {Object.entries(preview.ops).map(([k, n]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt>{OP_LABEL[k] ?? k}</dt>
                <dd className="tabular-nums">{n}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2 text-muted-foreground">
              <dt>Skipped rows</dt>
              <dd className="tabular-nums">
                {preview.skipped.reduce((n, s) => n + s.rowIds.length, 0)}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border p-4 text-sm">
          <h3 className="font-medium">New items</h3>
          <p className="mt-2">
            <span className="text-muted-foreground">Accounts:</span>{" "}
            {preview.create.accounts.join(", ") || "none"}
          </p>
          <p className="mt-1">
            <span className="text-muted-foreground">Holdings:</span>{" "}
            {preview.create.holdings.join(", ") || "none"}
          </p>
          <p className="mt-1">
            <span className="text-muted-foreground">Categories:</span>{" "}
            {preview.create.categories.length || "none"}
            {preview.create.categories.length ? (
              <span className="text-muted-foreground">
                {" "}
                ({preview.create.categories.slice(0, 8).join(", ")}
                {preview.create.categories.length > 8 ? "…" : ""})
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Balance check</h3>
        <p className="text-sm text-muted-foreground">
          {mismatches.length
            ? `${mismatches.length} account${mismatches.length === 1 ? "" : "s"} will differ from Money Manager (usually skipped or ignored rows).`
            : "Every account will match Money Manager’s own balance."}
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className={cn("w-full text-sm", stackOnPhone)}>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">WealthTrack after import</th>
                <th className="px-3 py-2 text-right font-medium">Money Manager</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {preview.balances.map((b) => {
                const diff = b.wealthTrackMinor - b.moneyManagerMinor;
                return (
                  <tr
                    key={b.ref}
                    className={cn("border-t", diff !== 0 && "bg-destructive/5")}
                    data-testid="balance-row"
                  >
                    <td className="px-3 py-2">
                      {b.name}
                      {b.isNew ? (
                        <span className="text-xs text-muted-foreground"> · new</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money valueMinor={b.wealthTrackMinor} currency={b.currency} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money valueMinor={b.moneyManagerMinor} currency={b.currency} />
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right",
                        diff !== 0 && "font-medium text-destructive",
                      )}
                    >
                      {diff === 0 ? (
                        "✓ matches"
                      ) : (
                        <Money valueMinor={diff} currency={b.currency} signed />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {preview.holdings.length ? (
          <p className="text-sm text-muted-foreground">
            Holding values after import:{" "}
            {preview.holdings.map((h, i) => (
              <span key={h.ref}>
                {i ? ", " : ""}
                {h.name} <Money valueMinor={h.valueMinor} currency={ccy} />
              </span>
            ))}
          </p>
        ) : null}
      </div>

      <details className="rounded-lg border">
        <summary className="cursor-pointer px-4 py-3 font-medium max-md:py-3">
          Monthly income and expenses
        </summary>
        <div className="overflow-x-auto border-t">
          <table className={cn("w-full text-sm", stackOnPhone)}>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">Income (sheet)</th>
                <th className="px-3 py-2 text-right font-medium">Income (import)</th>
                <th className="px-3 py-2 text-right font-medium">Expenses (sheet)</th>
                <th className="px-3 py-2 text-right font-medium">Expenses (import)</th>
              </tr>
            </thead>
            <tbody>
              {preview.monthly.map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="px-3 py-1.5 tabular-nums">{m.month}</td>
                  {[
                    [m.sheetIncomeMinor, m.incomeMinor],
                    [m.sheetExpenseMinor, m.expenseMinor],
                  ].flatMap(([sheet, mine], i) => [
                    <td key={`s${i}`} className="px-3 py-1.5 text-right">
                      <Money valueMinor={sheet!} currency={ccy} />
                    </td>,
                    <td
                      key={`m${i}`}
                      className={cn("px-3 py-1.5 text-right", sheet !== mine && "text-destructive")}
                    >
                      <Money valueMinor={mine!} currency={ccy} />
                    </td>,
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Transfers and Difference rows are not income or expenses.
          </p>
        </div>
      </details>

      {preview.skipped.length ? (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 font-medium max-md:py-3">
            Skipped ({preview.skipped.length})
          </summary>
          <ul className="border-t px-4 py-3 text-sm">
            {Object.entries(
              preview.skipped.reduce<Record<string, number>>((acc, s) => {
                acc[s.reason] = (acc[s.reason] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([reason, n]) => (
              <li key={reason}>
                {reason}: {n}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />I reviewed
          the mapping
        </label>
        <Button disabled={!reviewed || pending || preview.blockers.length > 0} onClick={commit}>
          {pending ? "Importing…" : "Import"}
        </Button>
      </div>
    </section>
  );
}

/** Step 8 — result with links and Undo. `result` is null when reopening a finished import. */
export function ResultStep({ data, result }: { data: WizardData; result: ImportResult | null }) {
  const [archive, setArchive] = useState(true);
  const [undone, setUndone] = useState(data.status === "reverted");

  async function undo() {
    const res = await undoImportAction({ batchId: data.batchId, archiveCreated: archive });
    if (!res.ok) {
      toast.error(res.error.message);
      return false;
    }
    toast.success(`Undone — ${res.data.voided} transactions voided`);
    setUndone(true);
  }

  return (
    <section aria-labelledby="result-title" className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-6 text-primary" aria-hidden />
        <h2 id="result-title" className="text-lg font-semibold">
          {undone ? "Import undone" : "Import complete"}
        </h2>
      </div>
      {result && !undone ? (
        <p className="text-sm">
          {result.transactions} transactions and {result.valuations} valuations imported. Created{" "}
          {result.created.accounts} accounts, {result.created.holdings} holdings and{" "}
          {result.created.categories} categories.
        </p>
      ) : null}
      {undone ? (
        <p className="text-sm">The transactions were voided and balances recalculated.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Link href="/transactions" className={buttonVariants()}>
              View transactions
            </Link>
            <Link href="/accounts" className={buttonVariants({ variant: "outline" })}>
              Accounts
            </Link>
            <Link href="/assets" className={buttonVariants({ variant: "outline" })}>
              Assets
            </Link>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Made a mistake?</p>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <Checkbox checked={archive} onCheckedChange={(v) => setArchive(v === true)} />
              Also archive the accounts, holdings and categories this import created (if nothing
              else uses them)
            </label>
            <ConfirmDialog
              trigger={
                <Button variant="destructive" className="mt-3">
                  <Undo2 aria-hidden /> Undo this import
                </Button>
              }
              title="Undo this import?"
              description="Voids every transaction from this import, removes its valuations and recalculates your balances. Voided transactions stay in the history."
              confirmLabel="Undo import"
              destructive
              onConfirm={undo}
            />
          </div>
        </>
      )}
      <Link href="/transactions/import" className={buttonVariants({ variant: "ghost" })}>
        Back to imports
      </Link>
    </section>
  );
}
