"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action-result";
import {
  archiveCategoryAction,
  createCategoryAction,
  unarchiveCategoryAction,
  updateCategoryAction,
} from "@/modules/categories/actions";
import type { CategoryKind } from "@/modules/categories/model";
import type { CategoryDTO, CategoryNode } from "@/modules/categories/schemas";

type Editing =
  | { mode: "create"; kind: CategoryKind; parent: CategoryDTO | null }
  | { mode: "rename"; category: CategoryDTO };

function NameDialog({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const router = useRouter();
  // Remounted per edit target (see `key` below), so state starts from the props.
  const [name, setName] = React.useState(editing?.mode === "rename" ? editing.category.name : "");
  const [error, setError] = React.useState<string>();
  const [pending, setPending] = React.useState(false);

  if (!editing) return null;
  const title =
    editing.mode === "rename"
      ? `Rename ${editing.category.name}`
      : editing.parent
        ? `Add under ${editing.parent.name}`
        : `Add ${editing.kind} category`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setPending(true);
    const result =
      editing.mode === "rename"
        ? await updateCategoryAction(editing.category.id, { name })
        : await createCategoryAction({
            name,
            kind: editing.kind,
            parentId: editing.parent?.id ?? null,
          });
    setPending(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
      return;
    }
    toast.success(editing.mode === "rename" ? "Category renamed" : `${result.data.name} added`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Categories have two levels: a group and its subcategories.
          </DialogDescription>
        </DialogHeader>
        <form id="category-form" onSubmit={submit} noValidate>
          <FormField id="category-name" label="Name" error={error}>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              {...fieldAria("category-name", error)}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({
  category,
  depth,
  onEdit,
  onAddChild,
  run,
}: {
  category: CategoryDTO;
  depth: 0 | 1;
  onEdit: () => void;
  onAddChild?: () => void;
  run: (fn: () => Promise<ActionResult<unknown>>, success: string) => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 py-2",
        depth === 1 && "pl-6",
        category.archived && "opacity-60",
      )}
    >
      <span className={cn("min-w-0 flex-1 truncate", depth === 0 && "font-medium")}>
        {category.name}
      </span>
      {category.isSystem ? (
        <Badge variant="outline" title="System category">
          <Lock aria-hidden /> System
        </Badge>
      ) : null}
      {category.archived ? <Badge variant="secondary">Archived</Badge> : null}
      {category.kind === "expense" && !category.archived ? (
        <span className="flex items-center gap-1.5">
          <Switch
            id={`essential-${category.id}`}
            size="sm"
            checked={category.isEssential}
            onCheckedChange={(checked) =>
              run(
                () => updateCategoryAction(category.id, { isEssential: checked }),
                checked
                  ? `${category.name} marked essential`
                  : `${category.name} no longer essential`,
              )
            }
          />
          <Label htmlFor={`essential-${category.id}`} className="text-xs text-muted-foreground">
            Essential
          </Label>
        </span>
      ) : null}
      {!category.isSystem && !category.archived ? (
        <>
          {onAddChild ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Add subcategory to ${category.name}`}
              onClick={onAddChild}
            >
              <Plus aria-hidden />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Rename ${category.name}`}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Archive ${category.name}`}
            onClick={() =>
              run(() => archiveCategoryAction(category.id), `${category.name} archived`)
            }
          >
            <Archive aria-hidden />
          </Button>
        </>
      ) : null}
      {category.archived ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Restore ${category.name}`}
          onClick={() =>
            run(() => unarchiveCategoryAction(category.id), `${category.name} restored`)
          }
        >
          <ArchiveRestore aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** Settings → Categories: two-level tree per kind, essential flag, add/rename/archive. */
export function CategoriesManager({ tree }: { tree: CategoryNode[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

  function run(fn: () => Promise<ActionResult<unknown>>, success: string) {
    void fn().then((result) => {
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  const visible = (c: CategoryDTO) => showArchived || !c.archived;

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id="show-archived-categories"
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        <Label htmlFor="show-archived-categories">Show archived</Label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => (
          <Card key={kind}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>
                  {kind === "expense" ? "Expense categories" : "Income categories"}
                </CardTitle>
                <CardDescription>
                  {kind === "expense"
                    ? "Essential categories drive the emergency fund target."
                    : "Where your money comes from."}
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing({ mode: "create", kind, parent: null })}
              >
                <Plus aria-hidden /> Add
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {tree
                  .filter((c) => c.kind === kind && visible(c))
                  .map((root) => (
                    <React.Fragment key={root.id}>
                      <CategoryRow
                        category={root}
                        depth={0}
                        run={run}
                        onEdit={() => setEditing({ mode: "rename", category: root })}
                        onAddChild={() => setEditing({ mode: "create", kind, parent: root })}
                      />
                      {root.children.filter(visible).map((child) => (
                        <CategoryRow
                          key={child.id}
                          category={child}
                          depth={1}
                          run={run}
                          onEdit={() => setEditing({ mode: "rename", category: child })}
                        />
                      ))}
                    </React.Fragment>
                  ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      <NameDialog
        key={
          editing
            ? editing.mode === "rename"
              ? editing.category.id
              : `new-${editing.kind}-${editing.parent?.id ?? "root"}`
            : "none"
        }
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
