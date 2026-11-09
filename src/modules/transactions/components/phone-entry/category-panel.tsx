"use client";

import * as React from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import type { CategoryNode } from "@/modules/categories/schemas";
import { cn } from "@/lib/utils";
import {
  PickerPanel,
  Tile,
  TileGrid,
} from "@/modules/transactions/components/phone-entry/picker-panel";
import { useRecentCategoryIds } from "@/modules/transactions/components/phone-entry/recent-categories";

/** "Food › Lunch" for a category id (a main category alone is just its name). */
export function categoryPath(
  tree: CategoryNode[],
  id: string,
): { main: string; sub?: string } | null {
  for (const root of tree) {
    if (root.id === id) return { main: root.name };
    const child = root.children.find((c) => c.id === id);
    if (child) return { main: root.name, sub: child.name };
  }
  return null;
}

/**
 * Category tiles (owner request, 2026-11-09): main categories first; one with sub-categories
 * (⌄) opens them, led by the main category itself ("No sub-category"). Recent picks on top.
 */
export function CategoryPanel({
  tree,
  kind,
  value,
  onPick,
  onClose,
}: {
  tree: CategoryNode[];
  kind: "expense" | "income";
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const roots = tree.filter((c) => c.kind === kind && !c.archived);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = roots.find((r) => r.id === openId) ?? null;
  const recent = useRecentCategoryIds(kind)
    .map((id) => ({ id, path: categoryPath(roots, id) }))
    .filter((r) => r.path !== null)
    .slice(0, 6);

  if (open) {
    const children = open.children.filter((c) => !c.archived);
    return (
      <PickerPanel
        onClose={onClose}
        title={
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="-ml-2 flex min-h-11 items-center gap-0.5 rounded-md pr-2 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:outline-none"
            aria-label={`Back to all categories (in ${open.name})`}
          >
            <ChevronLeft className="size-5" aria-hidden />
            {open.name}
          </button>
        }
      >
        <TileGrid label={`${open.name} sub-categories`}>
          <Tile
            selected={value === open.id}
            onClick={() => onPick(open.id)}
            label={`${open.name}, no sub-category`}
          >
            <span>{open.name}</span>
            <span className="text-xs text-muted-foreground">No sub-category</span>
          </Tile>
          {children.map((c) => (
            <Tile key={c.id} selected={value === c.id} onClick={() => onPick(c.id)}>
              {c.name}
            </Tile>
          ))}
        </TileGrid>
      </PickerPanel>
    );
  }

  return (
    <PickerPanel title="Category" onClose={onClose}>
      {recent.length ? (
        <div
          role="group"
          aria-label="Recent categories"
          className="flex [scrollbar-width:none] gap-2 overflow-x-auto border-b px-3 py-2.5"
        >
          <span className="shrink-0 self-center text-xs text-muted-foreground">Recent</span>
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              aria-pressed={value === r.id}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-sm",
                value === r.id && "border-foreground font-medium",
              )}
            >
              {r.path!.main}
              {r.path!.sub ? ` › ${r.path!.sub}` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {roots.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          No {kind} categories yet. Add them in Settings.
        </p>
      ) : (
        <TileGrid label="Categories">
          {roots.map((root) => {
            const hasChildren = root.children.some((c) => !c.archived);
            const within = root.id === value || root.children.some((c) => c.id === value);
            return (
              <Tile
                key={root.id}
                selected={within}
                onClick={() => (hasChildren ? setOpenId(root.id) : onPick(root.id))}
                label={hasChildren ? `${root.name}, has sub-categories` : undefined}
              >
                <span>{root.name}</span>
                {hasChildren ? (
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
                ) : null}
              </Tile>
            );
          })}
        </TileGrid>
      )}
    </PickerPanel>
  );
}
