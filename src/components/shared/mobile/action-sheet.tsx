"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

// docs/07 §3 — context menus become an action sheet on phones (a list in a bottom sheet with a
// Cancel row; destructive actions in red, last). md+: the regular dropdown menu.

export interface SheetAction {
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ActionSheetProps {
  /** The `⋯` button (or any element) that opens the menu. */
  trigger: React.ReactElement;
  /** Sheet heading on phones, e.g. the row's name. */
  title: string;
  description?: string;
  actions: SheetAction[];
}

export function ActionSheet({ trigger, title, description, actions }: ActionSheetProps) {
  const isMobile = useIsMobile();
  const safe = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);

  if (!isMobile) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align="end" className="min-w-44">
          {safe.map((a) => (
            <DropdownMenuItem key={a.label} disabled={a.disabled} onClick={a.onSelect}>
              {a.icon ? <a.icon aria-hidden /> : null}
              {a.label}
            </DropdownMenuItem>
          ))}
          {safe.length && destructive.length ? <DropdownMenuSeparator /> : null}
          {destructive.map((a) => (
            <DropdownMenuItem
              key={a.label}
              variant="destructive"
              disabled={a.disabled}
              onClick={a.onSelect}
            >
              {a.icon ? <a.icon aria-hidden /> : null}
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const row = (a: SheetAction) => (
    <DialogClose
      key={a.label}
      disabled={a.disabled}
      onClick={a.onSelect}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 px-4 text-left text-base active:bg-muted disabled:opacity-50",
        a.destructive && "text-destructive",
      )}
    >
      {a.icon ? <a.icon className="size-5" aria-hidden /> : null}
      {a.label}
    </DialogClose>
  );

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent showCloseButton={false}>
        <DialogHeader className="text-center">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="-mx-4 divide-y border-y">
          {safe.map(row)}
          {destructive.map(row)}
        </div>
        <DialogClose className="flex min-h-12 w-full items-center justify-center rounded-lg bg-muted text-base font-medium">
          Cancel
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
