import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  description?: ReactNode;
  children: ReactNode;
}

/** Label + control + inline error. Give the control `id`, `aria-invalid` and `aria-describedby`. */
export function FormField({ id, label, error, description, children }: FormFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {description && !error ? (
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** aria props linking a control to its FormField messages. */
export function fieldAria(id: string, error: string | undefined, hasDescription = false) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hasDescription ? `${id}-description` : undefined,
  } as const;
}
