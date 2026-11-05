"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { isLiability } from "@/domain/accounts";
import {
  reconcileAdjustment,
  reconcileDefaultRecordAs,
  reconcileRecordAllowed,
  type ReconcileRecordAs,
} from "@/domain/ledger";
import { reconcileAccountAction } from "@/modules/accounts/actions";
import type { AccountDTO } from "@/modules/accounts/schemas";
import { getCategoryTreeAction } from "@/modules/categories/actions";
import { CategorySelect } from "@/modules/categories/components/category-select";
import type { CategoryNode } from "@/modules/categories/schemas";

/** Default category names (docs/04 §1); the server falls back the same way when none is sent. */
const DEFAULT_CATEGORY = { expense: "Bank fees", income: "Interest" } as const;

function findByName(tree: readonly CategoryNode[], kind: "expense" | "income", name: string) {
  for (const n of tree) {
    if (n.kind !== kind) continue;
    if (n.name === name) return n.id;
    const child = n.children.find((c) => c.name === name);
    if (child) return child.id;
  }
  return "";
}

/**
 * Reconcile (docs/04 §1): enter the real balance; the difference is posted as an expense (default
 * when lower), income (default when higher) or a balance adjustment that stays out of cashflow.
 */
interface ReconcileProps {
  account: AccountDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayKey: string;
}

export function ReconcileDialog(props: ReconcileProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {props.open ? <ReconcileForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted fresh on every open, so its state starts from the current balance. */
function ReconcileForm({ account, onOpenChange, todayKey }: ReconcileProps) {
  const router = useRouter();
  const liability = isLiability(account.type);
  // Liabilities are entered as the amount owed (positive) and stored negative.
  const toDisplay = (balance: number) => (liability ? -balance : balance);
  const [actual, setActual] = React.useState<number | null>(toDisplay(account.balanceMinor));
  const [date, setDate] = React.useState<string | null>(todayKey);
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);
  const [chosen, setChosen] = React.useState<ReconcileRecordAs | null>(null);
  const [tree, setTree] = React.useState<CategoryNode[] | null>(null);
  const [picked, setPicked] = React.useState<Record<"expense" | "income", string>>({
    expense: "",
    income: "",
  });

  React.useEffect(() => {
    let live = true;
    void getCategoryTreeAction().then((r) => {
      if (live && r.ok) setTree(r.data);
    });
    return () => {
      live = false;
    };
  }, []);

  const valid = actual !== null && !Number.isNaN(actual);
  const real = valid ? (liability ? -actual : actual) : null;
  const adj = real !== null ? reconcileAdjustment(account.balanceMinor, real) : null;
  const signed = adj ? (adj.direction === "to" ? adj.amountMinor : -adj.amountMinor) : 0;
  // A choice that no longer fits the direction (e.g. the amount changed sign) falls back to the default.
  const recordAs: ReconcileRecordAs | null = adj
    ? chosen && reconcileRecordAllowed(adj.direction, chosen)
      ? chosen
      : reconcileDefaultRecordAs(adj.direction)
    : null;
  const kind = recordAs === "expense" || recordAs === "income" ? recordAs : null;
  const categoryId = kind
    ? picked[kind] || (tree ? findByName(tree, kind, DEFAULT_CATEGORY[kind]) : "")
    : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (real === null || !date) {
      setError("Enter the actual balance");
      return;
    }
    setPending(true);
    const result = await reconcileAccountAction(account.id, {
      realBalanceMinor: real,
      date,
      ...(recordAs ? { recordAs } : {}),
      ...(kind && categoryId ? { categoryId } : {}),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.realBalanceMinor?.[0] ?? result.error.message);
      toast.error(result.error.message);
      return;
    }
    toast.success(
      result.data.adjustmentMinor === 0
        ? "Already in balance"
        : recordAs === "expense"
          ? "Balance matched · expense recorded"
          : recordAs === "income"
            ? "Balance matched · income recorded"
            : "Balance adjusted",
    );
    onOpenChange(false);
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reconcile {account.name}</DialogTitle>
        <DialogDescription>
          Enter what your statement or app shows. Record any difference as an expense (e.g. bank
          charges), income (e.g. interest) or a balance adjustment.
        </DialogDescription>
      </DialogHeader>
      <form id="reconcile-form" onSubmit={submit} noValidate className="grid gap-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {liability ? "Recorded owed" : "Recorded balance"}
          </span>
          <Money valueMinor={toDisplay(account.balanceMinor)} currency={account.currency} />
        </div>
        <FormField
          id="reconcile-actual"
          label={liability ? "Actual amount owed" : "Actual balance"}
          error={error}
        >
          <MoneyInput
            id="reconcile-actual"
            currency={account.currency}
            value={actual}
            onChange={setActual}
            autoFocus
            {...fieldAria("reconcile-actual", error)}
          />
        </FormField>
        <FormField id="reconcile-date" label="As of">
          <DatePicker id="reconcile-date" value={date} onChange={setDate} />
        </FormField>
        <div
          className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"
          aria-live="polite"
        >
          <span>Difference</span>
          {adj ? (
            <Money valueMinor={signed} currency={account.currency} signed />
          ) : (
            <span className="text-muted-foreground">None — balances match</span>
          )}
        </div>
        {adj && recordAs ? (
          <div className="grid gap-2">
            <Label id="reconcile-as-label">Record the difference as</Label>
            <RadioGroup
              aria-labelledby="reconcile-as-label"
              value={recordAs}
              onValueChange={(v) => setChosen(v as ReconcileRecordAs)}
              className="grid gap-2"
            >
              {(adj.direction === "from"
                ? (["expense", "adjustment"] as const)
                : (["income", "adjustment"] as const)
              ).map((v) => (
                <Label
                  key={v}
                  className="flex items-start gap-2 rounded-lg border p-2.5 font-normal"
                >
                  <RadioGroupItem value={v} className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span>
                      {v === "expense"
                        ? "Expense"
                        : v === "income"
                          ? "Income"
                          : "Balance adjustment"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {v === "adjustment"
                        ? "An old mistake or a wrong opening balance: not counted in income or expenses"
                        : v === "expense"
                          ? "Money the bank took that you did not record, e.g. charges"
                          : "Money the bank paid that you did not record, e.g. interest"}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {kind ? (
              <FormField id="reconcile-category" label="Category">
                <CategorySelect
                  id="reconcile-category"
                  tree={tree ?? []}
                  kind={kind}
                  value={categoryId}
                  onChange={(id) => setPicked((p) => ({ ...p, [kind]: id }))}
                  placeholder={tree ? "Choose a category" : "Loading…"}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}
      </form>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" form="reconcile-form" disabled={pending || !valid}>
          {pending ? "Saving…" : "Reconcile"}
        </Button>
      </DialogFooter>
    </>
  );
}
