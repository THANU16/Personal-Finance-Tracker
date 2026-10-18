"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORICAL, paletteSlot, vizColor } from "@/lib/viz-palette";

/** Picks a chart colour from the validated palette (a custom hex from earlier is kept as "Custom"). */
export function PaletteSelect({
  value,
  onChange,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
  id?: string;
}) {
  const custom = paletteSlot(value) === null;
  const items = [
    ...(custom ? [{ value, label: "Custom" }] : []),
    ...CATEGORICAL.map((c) => ({ value: c.light, label: c.name })),
  ];
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-32">
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-sm"
          style={{ background: vizColor(value) }}
        />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-sm"
              style={{ background: vizColor(item.value) }}
            />
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
