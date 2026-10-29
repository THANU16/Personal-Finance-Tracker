"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponsiveSelect } from "@/components/shared/mobile/responsive-select";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CategoryKind } from "@/modules/categories/model";
import type { CategoryNode } from "@/modules/categories/schemas";

export function flattenCategories(tree: CategoryNode[], kind: CategoryKind) {
  return tree
    .filter((c) => c.kind === kind)
    .flatMap((root) => [
      { id: root.id, label: root.name, depth: 0 },
      ...root.children.map((c) => ({
        id: c.id,
        label: `${root.name} › ${c.name}`,
        depth: 1,
        name: c.name,
      })),
    ]);
}

/** Two-level category picker (children indented under their parent). */
export function CategorySelect({
  id,
  tree,
  kind,
  value,
  onChange,
  placeholder = "Choose a category",
  allowAll,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: {
  id?: string;
  tree: CategoryNode[];
  kind: CategoryKind;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Adds an "All categories" option with value "". */
  allowAll?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** When there is no visible <label for={id}> (filters). */
  "aria-label"?: string;
}) {
  const isMobile = useIsMobile();
  const options = flattenCategories(tree, kind);
  if (isMobile) {
    // docs/07 §3: a searchable bottom-sheet picker on phones, grouped by parent category.
    const picker = tree
      .filter((c) => c.kind === kind)
      .flatMap((root) => [
        { value: root.id, label: root.name, group: root.name },
        ...root.children.map((c) => ({
          value: c.id,
          label: `${root.name} › ${c.name}`,
          group: root.name,
        })),
      ]);
    return (
      <ResponsiveSelect
        id={id}
        value={value || null}
        onValueChange={onChange}
        options={[...(allowAll ? [{ value: "", label: "All categories" }] : []), ...picker]}
        placeholder={allowAll ? "All categories" : placeholder}
        title={allowAll ? "Category" : placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
    );
  }
  const items = [
    ...(allowAll ? [{ value: "", label: "All categories" }] : []),
    ...options.map((o) => ({ value: o.id, label: o.label })),
  ];
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={items}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className="w-full"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      >
        <SelectValue placeholder={allowAll ? "All categories" : placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {allowAll ? <SelectItem value="">All categories</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className={o.depth ? "pl-6" : "font-medium"}>
            {o.depth ? (o as { name: string }).name : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
