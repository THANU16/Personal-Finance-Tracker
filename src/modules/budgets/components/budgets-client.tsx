"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, parse } from "date-fns";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { previousMonth, type BudgetStatus } from "@/domain/budgets";
import { formatPercentBp } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  copyLastMonthAction,
  removeBudgetAction,
  setBudgetAction,
} from "@/modules/budgets/actions";
import type { BudgetMonthDTO, BudgetRowDTO } from "@/modules/budgets/service";

const monthLabel = (m: string) => format(parse(m, "yyyy-MM", new Date(2000, 0, 1)), "MMMM yyyy");
const nextMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number) as [number, number];
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
};
const STATUS_TEXT: Record<BudgetStatus, string> = {
  ok: "On budget",
  warn: "80% used",
  over: "Over budget",
};
// Bar colour follows docs/05 §11 (amber ≥ 80%, red ≥ 100%); the text label carries the same state.
const BAR: Record<BudgetStatus, string> = {
  ok: "bg-[var(--viz-series-1)]",
  warn: "bg-amber-500",
  over: "bg-destructive",
};

function Bar({ usedBp, status }: { usedBp: number; status: BudgetStatus }) {
  return (
    <div className="h-2 rounded-full bg-muted" aria-hidden>
      <div
        className={cn("h-2 rounded-full", BAR[status])}
        style={{ width: `${Math.min(100, usedBp / 100)}%` }}
      />
    </div>
  );
}

function BudgetDialog({
  data,
  row,
  onClose,
}: {
  data: BudgetMonthDTO;
  row: BudgetRowDTO | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const taken = new Set(data.rows.map((r) => r.categoryId));
  const choices = data.categories.filter((c) => !taken.has(c.id) || c.id === row?.categoryId);
  const [categoryId, setCategoryId] = useState(row?.categoryId ?? "");
  const [amount, setAmount] = useState<number | null>(row?.budgetMinor ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? `Budget for ${row.name}` : "Add budget"}</DialogTitle>
          <DialogDescription>
            {monthLabel(data.month)}. Spending in sub-categories counts too.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!row ? (
            <FormField id="budget-category" label="Category">
              <Select
                value={categoryId}
                onValueChange={(v) => setCategoryId(String(v ?? ""))}
                items={choices.map((c) => ({ value: c.id, label: c.label }))}
              >
                <SelectTrigger id="budget-category" className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {choices.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField id="budget-amount" label="Monthly budget" error={error ?? undefined}>
            <MoneyInput
              id="budget-amount"
              currency={data.currency}
              value={amount}
              onChange={setAmount}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !categoryId}
            onClick={() =>
              start(async () => {
                const res = await setBudgetAction({
                  month: data.month,
                  categoryId,
                  amountMinor: amount ?? Number.NaN,
                });
                if (!res.ok) {
                  setError(res.error.fieldErrors?.amountMinor?.[0] ?? res.error.message);
                  return;
                }
                toast.success("Budget saved");
                onClose();
                router.refresh();
              })
            }
          >
            Save budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BudgetsClient({ data }: { data: BudgetMonthDTO }) {
  const router = useRouter();
  const [editing, setEditing] = useState<BudgetRowDTO | "new" | null>(null);
  const [pending, start] = useTransition();
  const ccy = data.currency;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Month" className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            render={<Link href={`/budgets?month=${previousMonth(data.month)}`} />}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-36 text-center font-medium">{monthLabel(data.month)}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            render={<Link href={`/budgets?month=${nextMonth(data.month)}`} />}
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending || data.previousMonthBudgets === 0}
            onClick={() =>
              start(async () => {
                const res = await copyLastMonthAction(data.month);
                if (!res.ok) toast.error(res.error.message);
                else {
                  toast.success(
                    res.data.copied
                      ? `Copied ${res.data.copied} budget${res.data.copied === 1 ? "" : "s"}`
                      : "Nothing new to copy",
                  );
                  router.refresh();
                }
              })
            }
          >
            <Copy aria-hidden /> Copy last month
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add budget
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
            <span>Budgets</span>
            <span className="text-sm font-normal text-muted-foreground">
              <Money valueMinor={data.totals.spentMinor} currency={ccy} /> of{" "}
              <Money valueMinor={data.totals.budgetMinor} currency={ccy} /> ·{" "}
              {formatPercentBp(data.totals.usedBp)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.rows.length ? (
            <ul className="divide-y">
              {data.rows.map((r) => (
                <li
                  key={r.categoryId}
                  className={cn(
                    "grid gap-2 py-3 sm:grid-cols-[minmax(10rem,1fr)_2fr_auto] sm:items-center",
                    r.parentName && "sm:pl-6",
                  )}
                  data-testid={`budget-${r.name}`}
                >
                  <div>
                    <p className="font-medium">
                      {r.icon ? <span aria-hidden>{r.icon} </span> : null}
                      {r.name}
                    </p>
                    {r.parentName ? (
                      <p className="text-xs text-muted-foreground">in {r.parentName}</p>
                    ) : null}
                  </div>
                  <div>
                    <Bar usedBp={r.usedBp} status={r.status} />
                    <p className="mt-1 flex flex-wrap justify-between gap-2 text-xs">
                      <span>
                        <Money valueMinor={r.spentMinor} currency={ccy} /> of{" "}
                        <Money valueMinor={r.budgetMinor} currency={ccy} />
                      </span>
                      <span
                        className={cn(
                          r.status === "over" && "text-destructive",
                          r.status === "warn" && "font-medium",
                        )}
                      >
                        {formatPercentBp(r.usedBp)} · {STATUS_TEXT[r.status]} ·{" "}
                        {r.remainingMinor >= 0 ? (
                          <>
                            <Money valueMinor={r.remainingMinor} currency={ccy} /> left
                          </>
                        ) : (
                          <>
                            <Money
                              valueMinor={-r.remainingMinor}
                              currency={ccy}
                              colorNegative={false}
                            />{" "}
                            over
                          </>
                        )}
                      </span>
                    </p>
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove budget for ${r.name}`}
                      onClick={() =>
                        start(async () => {
                          const res = await removeBudgetAction({
                            month: data.month,
                            categoryId: r.categoryId,
                          });
                          if (!res.ok) toast.error(res.error.message);
                          else router.refresh();
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No budgets for {monthLabel(data.month)}.{" "}
              {data.previousMonthBudgets
                ? "Copy last month’s or add one."
                : "Add one per expense category."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
            <span>Unbudgeted spending</span>
            <span className="text-sm font-normal text-muted-foreground">
              <Money valueMinor={data.unbudgetedTotalMinor} currency={ccy} />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.unbudgeted.length ? (
            <ul className="divide-y text-sm">
              {data.unbudgeted.map((u) => (
                <li key={u.categoryId} className="flex justify-between gap-3 py-1.5">
                  <span>{u.name}</span>
                  <Money valueMinor={u.spentMinor} currency={ccy} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              All spending this month is covered by a budget.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Total spending this month <Money valueMinor={data.monthSpentMinor} currency={ccy} />{" "}
            (expenses, bank fees and loan interest).
            {data.fxMissing ? ` ${data.fxMissing} item(s) left out: FX rate missing.` : ""}
          </p>
        </CardContent>
      </Card>
      {editing ? (
        <BudgetDialog
          data={data}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
