"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface PickOption {
  value: string;
  label: string;
}

/** Compact labelled select used in the import wizard tables. */
export function Pick({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose…",
  className,
  invalid,
}: {
  label: string;
  value: string;
  options: PickOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={options}>
      <SelectTrigger
        aria-label={label}
        aria-invalid={invalid}
        className={cn("w-full min-w-40", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
