"use client";

import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CategoryChoice, WizardData, WizardState } from "@/modules/imports/schemas";
import { categoryResolved } from "@/modules/imports/components/wizard-helpers";
import { Pick } from "@/modules/imports/components/wizard-pick";

const ACTIONS = [
  { value: "existing", label: "Map to existing" },
  { value: "create", label: "Create new" },
  { value: "merge", label: "Merge into…" },
  { value: "uncategorised", label: "Uncategorised" },
];

type SetState = React.Dispatch<React.SetStateAction<WizardState>>;

/** Steps 3 and 4 — category tree (subcategories as children); income and expense are separate. */
export function CategoriesStep({
  kind,
  data,
  state,
  setState,
}: {
  kind: "expense" | "income";
  data: WizardData;
  state: WizardState;
  setState: SetState;
}) {
  const field = kind === "expense" ? "expenseCategories" : "incomeCategories";
  const nodes = kind === "expense" ? data.expenseCategories : data.incomeCategories;
  const existing =
    kind === "expense" ? data.options.expenseCategories : data.options.incomeCategories;
  const hints = kind === "expense" ? data.hints.expense : data.hints.income;
  const choices = state[field];
  const nameOf = (key: string) => {
    const n = nodes.find((x) => x.key === key);
    if (!n) return key;
    const parent = n.parentKey ? nodes.find((x) => x.key === n.parentKey) : undefined;
    return parent ? `${parent.name} › ${n.name}` : n.name;
  };
  const set = (key: string, choice: CategoryChoice) =>
    setState((s) => ({ ...s, [field]: { ...s[field], [key]: choice } }));

  function action(key: string, name: string, value: string) {
    if (value === "existing") set(key, { action: "existing", existingId: existing[0]?.id ?? "" });
    else if (value === "create") set(key, { action: "create", name, isEssential: false });
    else if (value === "merge") set(key, { action: "merge", into: "" });
    else set(key, { action: "uncategorised" });
  }

  const title = kind === "expense" ? "Expense categories" : "Income categories";
  const ready = nodes.filter((n) => categoryResolved(choices[n.key])).length;
  const openHints = hints.filter((h) => {
    const c = choices[h.from];
    return !(c?.action === "merge" && c.into === h.to);
  });

  return (
    <section aria-labelledby={`${kind}-title`} className="space-y-4">
      <div>
        <h2 id={`${kind}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          Transfers, fees and Difference rows are handled in step 5 and not counted here. {ready} of{" "}
          {nodes.length} ready.
        </p>
      </div>

      {openHints.length ? (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Possible duplicates</p>
          <ul className="mt-1 space-y-1">
            {openHints.map((h) => (
              <li key={`${h.from}-${h.to}`} className="flex flex-wrap items-center gap-2">
                “{nameOf(h.from)}” looks like “{nameOf(h.to)}”.
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => set(h.from, { action: "merge", into: h.to })}
                >
                  Merge
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!nodes.length ? (
        <p className="text-sm text-muted-foreground">No {kind} rows in this file.</p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {nodes.map((n) => {
          const c = choices[n.key] ?? { action: "unset" as const };
          const ok = categoryResolved(c);
          const label = nameOf(n.key);
          return (
            <li
              key={n.key}
              className={cn(
                "grid gap-2 p-3 lg:grid-cols-[minmax(12rem,1fr)_10rem_minmax(14rem,1.2fr)_auto]",
                n.parentKey && "lg:pl-8",
              )}
              data-testid={`mm-${kind}-${n.key}`}
            >
              <div className="min-w-0">
                <p className={cn("truncate", !n.parentKey && "font-medium")}>
                  {n.icon ? <span aria-hidden>{n.icon} </span> : null}
                  {n.parentKey ? "↳ " : ""}
                  {n.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {n.rows} rows · <Money valueMinor={n.totalMinor} currency={data.baseCurrency} />
                </p>
              </div>
              <Pick
                label={`Action for ${label}`}
                value={c.action === "unset" ? "" : c.action}
                options={ACTIONS}
                onChange={(v) => action(n.key, n.name, v)}
                invalid={!ok}
              />
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                {c.action === "existing" ? (
                  <Pick
                    label={`Existing category for ${label}`}
                    value={c.existingId}
                    options={existing.map((o) => ({ value: o.id, label: o.label }))}
                    onChange={(v) => set(n.key, { action: "existing", existingId: v })}
                  />
                ) : null}
                {c.action === "create" ? (
                  <>
                    <Input
                      aria-label={`New category name for ${label}`}
                      value={c.name}
                      onChange={(e) => set(n.key, { ...c, name: e.target.value })}
                    />
                    {kind === "expense" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={c.isEssential}
                          onCheckedChange={(v) => set(n.key, { ...c, isEssential: v === true })}
                        />
                        Essential
                      </label>
                    ) : null}
                  </>
                ) : null}
                {c.action === "merge" ? (
                  <Pick
                    label={`Merge ${label} into`}
                    value={c.into}
                    placeholder="Choose a category"
                    options={nodes
                      .filter((o) => o.key !== n.key)
                      .map((o) => ({ value: o.key, label: nameOf(o.key) }))}
                    onChange={(v) => set(n.key, { action: "merge", into: v })}
                  />
                ) : null}
                {c.action === "uncategorised" ? (
                  <p className="text-sm text-muted-foreground">Goes to “Uncategorised”.</p>
                ) : null}
              </div>
              <Badge variant={ok ? "secondary" : "destructive"} className="self-center">
                {ok ? "Ready" : "Needs a choice"}
              </Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
