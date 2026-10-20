"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RuleField, RuleOperator } from "@/domain/category-rules";
import {
  deleteCategoryRuleAction,
  saveCategoryRuleAction,
} from "@/modules/categories/rules-actions";
import type { RuleDTO } from "@/modules/categories/rules-service";

const FIELD: Record<RuleField, string> = { description: "Description", counterparty: "Payee" };
const OPERATOR: Record<RuleOperator, string> = {
  contains: "contains",
  equals: "is exactly",
  regex: "matches pattern",
};

type CategoryOption = { id: string; label: string; kind: "income" | "expense" };

function RuleDialog({
  rule,
  categories,
  onClose,
}: {
  rule: RuleDTO | null;
  categories: CategoryOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [field, setField] = useState<RuleField>(rule?.matchField ?? "description");
  const [operator, setOperator] = useState<RuleOperator>(rule?.operator ?? "contains");
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const err = (k: string) => errors[k]?.[0];
  const items = categories.map((c) => ({
    value: c.id,
    label: `${c.label} (${c.kind === "income" ? "income" : "expense"})`,
  }));

  function save() {
    start(async () => {
      const res = await saveCategoryRuleAction(rule?.id ?? null, {
        matchField: field,
        operator,
        pattern,
        categoryId,
        priority: Number(priority) || 0,
      });
      if (!res.ok) {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
        return;
      }
      toast.success(rule ? "Rule saved" : "Rule added");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "Add rule"}</DialogTitle>
          <DialogDescription>
            Bank statement imports use the first matching rule (lowest priority number first). Money
            in only matches income categories; money out only expense categories.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="rule-field" label="When" error={err("matchField")}>
            <Select
              value={field}
              onValueChange={(v) => setField(v as RuleField)}
              items={Object.entries(FIELD).map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger id="rule-field" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FIELD).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="rule-op" label="Test" error={err("operator")}>
            <Select
              value={operator}
              onValueChange={(v) => setOperator(v as RuleOperator)}
              items={Object.entries(OPERATOR).map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger id="rule-op" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OPERATOR).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              id="rule-pattern"
              label="Text"
              error={err("pattern")}
              description={
                operator === "regex"
                  ? "A regular expression, case-insensitive."
                  : "Case does not matter."
              }
            >
              <Input
                id="rule-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField id="rule-category" label="Category" error={err("categoryId")}>
              <Select
                value={categoryId}
                onValueChange={(v) => setCategoryId(String(v ?? ""))}
                items={items}
              >
                <SelectTrigger id="rule-category" className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {items.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField
            id="rule-priority"
            label="Priority"
            error={err("priority")}
            description="Lower runs first."
          >
            <Input
              id="rule-priority"
              inputMode="numeric"
              value={priority}
              onChange={(e) => setPriority(e.target.value.replace(/\D/g, ""))}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings → Categories: import rules (docs/05 §17). */
export function CategoryRulesManager({
  rules,
  categories,
}: {
  rules: RuleDTO[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleDTO | "new" | null>(null);
  return (
    <section aria-labelledby="rules-title" className="max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="rules-title" className="font-medium">
            Import rules
          </h2>
          <p className="text-sm text-muted-foreground">
            Categorise bank statement rows automatically. Rows nothing matches get
            &ldquo;Uncategorised&rdquo;.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> Add rule
        </Button>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="w-10 text-xs text-muted-foreground tabular-nums">#{r.priority}</span>
              <span className="min-w-0 flex-1">
                {FIELD[r.matchField]} {OPERATOR[r.operator]}{" "}
                <code className="rounded bg-muted px-1">{r.pattern}</code> →{" "}
                <span className="font-medium">{r.categoryName}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                Edit
              </Button>
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="ghost">
                    Delete
                  </Button>
                }
                title="Delete this rule?"
                description="Future imports stop using it. Imported transactions keep their categories."
                confirmLabel="Delete"
                destructive
                onConfirm={async () => {
                  const res = await deleteCategoryRuleAction(r.id);
                  if (!res.ok) {
                    toast.error(res.error.message);
                    return false;
                  }
                  toast.success("Rule deleted");
                  router.refresh();
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <RuleDialog
          rule={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
