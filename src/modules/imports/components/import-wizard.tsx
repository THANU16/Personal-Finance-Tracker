"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewImportAction, saveImportMappingAction } from "@/modules/imports/actions";
import type { ImportResult, PreviewData, WizardData, WizardState } from "@/modules/imports/schemas";
import { accountResolved, categoryResolved } from "@/modules/imports/components/wizard-helpers";
import { AccountsStep } from "@/modules/imports/components/wizard-accounts-step";
import { CategoriesStep } from "@/modules/imports/components/wizard-categories-step";
import { ReviewStep } from "@/modules/imports/components/wizard-review-step";
import {
  OpeningsStep,
  PreviewStep,
  ResultStep,
} from "@/modules/imports/components/wizard-finish-steps";

// docs/07 §3 — the 8-step wizard. The mapping lives on the saved draft, so the user can leave and
// come back; every Next saves it.

export const STEPS = [
  "Upload",
  "Accounts",
  "Expense categories",
  "Income categories",
  "Review special rows",
  "Opening balances",
  "Preview",
  "Import",
] as const;

export function ImportWizard({ data }: { data: WizardData }) {
  const done = data.status === "imported" || data.status === "reverted";
  const [step, setStep] = useState(done ? 8 : 2);
  const [state, setState] = useState<WizardState>(data.state);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(
    done
      ? {
          batchId: data.batchId,
          transactions: 0,
          valuations: 0,
          created: { accounts: 0, categories: 0, holdings: 0 },
        }
      : null,
  );
  const [pending, start] = useTransition();

  const canNext =
    step === 2
      ? data.accounts.every((a) => accountResolved(state.accounts[a.key]))
      : step === 3
        ? data.expenseCategories.every((c) => categoryResolved(state.expenseCategories[c.key]))
        : step === 4
          ? data.incomeCategories.every((c) => categoryResolved(state.incomeCategories[c.key]))
          : step < 7;

  function go(next: number) {
    start(async () => {
      if (next >= 6) {
        const res = await previewImportAction({ batchId: data.batchId, state });
        if (!res.ok) {
          toast.error(res.error.message);
          return;
        }
        setPreview(res.data);
      } else {
        const res = await saveImportMappingAction({ batchId: data.batchId, state });
        if (!res.ok) {
          toast.error(res.error.message);
          return;
        }
      }
      setStep(next);
      window.scrollTo({ top: 0 });
    });
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Import progress">
        <ol className="flex flex-wrap gap-x-1 gap-y-2 text-xs sm:text-sm">
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <li
                key={label}
                aria-current={n === step ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                  n === step && "border-primary bg-primary text-primary-foreground",
                  n < step && "text-foreground",
                  n > step && "text-muted-foreground",
                )}
              >
                <span className="tabular-nums">{n}</span> {label}
              </li>
            );
          })}
        </ol>
      </nav>

      {data.warnings.length && step < 8 ? (
        <ul className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          {data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {step === 2 ? <AccountsStep data={data} state={state} setState={setState} /> : null}
      {step === 3 ? (
        <CategoriesStep kind="expense" data={data} state={state} setState={setState} />
      ) : null}
      {step === 4 ? (
        <CategoriesStep kind="income" data={data} state={state} setState={setState} />
      ) : null}
      {step === 5 ? <ReviewStep data={data} state={state} setState={setState} /> : null}
      {step === 6 && preview ? (
        <OpeningsStep data={data} preview={preview} state={state} setState={setState} />
      ) : null}
      {step === 7 && preview ? (
        <PreviewStep
          data={data}
          preview={preview}
          onImported={(r) => {
            setResult(r);
            setStep(8);
          }}
        />
      ) : null}
      {step === 8 && result ? <ResultStep data={data} result={done ? null : result} /> : null}

      {step < 8 ? (
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button variant="outline" disabled={pending || step <= 2} onClick={() => go(step - 1)}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          {step < 7 ? (
            <Button disabled={pending || !canNext} onClick={() => go(step + 1)}>
              {pending ? "Saving…" : "Next"} <ArrowRight aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
      {step === 7 && preview ? (
        <p className="text-xs text-muted-foreground">
          Changed something? Go Back — the preview reruns on every step.
        </p>
      ) : null}
    </div>
  );
}
