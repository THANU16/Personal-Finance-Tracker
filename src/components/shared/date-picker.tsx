"use client";

import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const KEY_FORMAT = "yyyy-MM-dd";

function keyToDate(key: string | null | undefined): Date | undefined {
  if (!key) return undefined;
  const d = parse(key, KEY_FORMAT, new Date());
  return isValid(d) ? d : undefined;
}

export interface DatePickerProps {
  /** Business date as `YYYY-MM-DD` (the user's calendar day, not an instant). */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "Pick a date",
  disabled,
  className,
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = keyToDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={aria["aria-invalid"]}
            className={cn(
              "w-full justify-start font-normal",
              !selected && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-4" aria-hidden />
        {selected ? format(selected, "d MMM yyyy") : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          onSelect={(d) => {
            onChange(d ? format(d, KEY_FORMAT) : null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
