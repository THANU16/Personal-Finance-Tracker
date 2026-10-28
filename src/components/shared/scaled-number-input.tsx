"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { groupDigits, groupWhileTyping } from "@/lib/typing-format";
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
  /** Show thousands separators while typing (phones, docs/07 §4); `parse` must accept commas. */
  groupWhileTyping?: boolean;
  /** Classes for the adornments (e.g. a larger currency code on the big amount field). */
  adornmentClassName?: string;
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
  groupWhileTyping: group = false,
  adornmentClassName,
  className,
  onBlur,
  ref,
  ...props
}: ScaledNumberInputProps) {
  const show = (formatted: string) => (group ? groupDigits(formatted) : formatted);
  const toText = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? "" : show(format(v));
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Keep the caller's ref (form libraries focus the first invalid field through it).
  const setRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const caretRef = React.useRef<number | null>(null);
  const [text, setText] = React.useState(() => toText(value));
  const [synced, setSynced] = React.useState<number | null | undefined>(value);

  // Adopt values set from outside (form reset) without clobbering what the user is typing.
  if (!Object.is(value, synced)) {
    setSynced(value);
    if (!Object.is(safeParse(parse, text), value)) setText(toText(value));
  }

  // Grouping turns on after hydration on phones: regroup (or ungroup) the text already shown.
  const [groupedFor, setGroupedFor] = React.useState(group);
  if (groupedFor !== group) {
    setGroupedFor(group);
    setText((t) => (group ? groupDigits(t) : t.replace(/,/g, "")));
  }

  // Regrouping moves characters around: put the caret back after the digit just typed.
  React.useLayoutEffect(() => {
    if (caretRef.current === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });

  return (
    <div className="relative">
      {startAdornment ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground",
            adornmentClassName,
          )}
        >
          {startAdornment}
        </span>
      ) : null}
      <Input
        {...props}
        ref={setRef}
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
          let next = e.target.value;
          if (group) {
            const typed = groupWhileTyping(next, e.target.selectionStart ?? next.length);
            next = typed.text;
            caretRef.current = typed.caret;
          }
          const parsed = safeParse(parse, next);
          setText(next);
          setSynced(parsed);
          onChange(parsed);
        }}
        onBlur={(e) => {
          const parsed = safeParse(parse, text);
          if (parsed !== null && !Number.isNaN(parsed)) setText(show(format(parsed)));
          onBlur?.(e);
        }}
      />
      {endAdornment ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground",
            adornmentClassName,
          )}
        >
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
}
