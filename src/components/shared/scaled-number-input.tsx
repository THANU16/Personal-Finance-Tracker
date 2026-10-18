"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ScaledNumberInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> {
  /** Integer value (minor units, bp…); null when empty; NaN while the text is invalid. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  parse: (text: string) => number | null;
  format: (value: number) => string;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
}

function safeParse(parse: (t: string) => number | null, text: string): number | null {
  try {
    return parse(text);
  } catch {
    return Number.NaN;
  }
}

/**
 * Text input that edits an integer scaled value without floats. Keeps the user's text while typing;
 * emits NaN for invalid text so the form's Zod schema reports it.
 */
export function ScaledNumberInput({
  value,
  onChange,
  parse,
  format,
  startAdornment,
  endAdornment,
  className,
  onBlur,
  ...props
}: ScaledNumberInputProps) {
  const toText = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? "" : format(v);
  const [text, setText] = React.useState(() => toText(value));
  const [synced, setSynced] = React.useState<number | null | undefined>(value);

  // Adopt values set from outside (form reset) without clobbering what the user is typing.
  if (!Object.is(value, synced)) {
    setSynced(value);
    if (!Object.is(safeParse(parse, text), value)) setText(toText(value));
  }

  return (
    <div className="relative">
      {startAdornment ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          {startAdornment}
        </span>
      ) : null}
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(
          "text-right tabular-nums",
          startAdornment && "pl-12",
          endAdornment && "pr-8",
          className,
        )}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          const parsed = safeParse(parse, next);
          setText(next);
          setSynced(parsed);
          onChange(parsed);
        }}
        onBlur={(e) => {
          const parsed = safeParse(parse, text);
          if (parsed !== null && !Number.isNaN(parsed)) setText(format(parsed));
          onBlur?.(e);
        }}
      />
      {endAdornment ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
}
