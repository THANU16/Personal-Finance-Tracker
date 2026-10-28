"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";

// docs/07 §2 — primary actions in the thumb zone. Phones: fixed above the tab bar (or above the
// keyboard while it is open), with a spacer so the end of the page is never hidden behind it.
// md+: an ordinary right-aligned button row in the page flow.

export interface StickyActionBarProps {
  /** Buttons; the primary one last (rightmost / bottom-right). */
  children: ReactNode;
  /** Optional status on the left, e.g. a total or "3 changed". */
  summary?: ReactNode;
  className?: string;
}

const TAB_BAR = "calc(3.5rem + env(safe-area-inset-bottom))";

export function StickyActionBar({ children, summary, className }: StickyActionBarProps) {
  const isMobile = useIsMobile();
  const keyboard = useKeyboardInset();
  return (
    <>
      <div aria-hidden className="h-20 md:hidden" />
      <div
        data-slot="sticky-action-bar"
        style={isMobile ? { bottom: keyboard > 0 ? keyboard : TAB_BAR } : undefined}
        className={cn(
          "fixed inset-x-0 z-30 flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur",
          "pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]",
          "md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none",
          className,
        )}
      >
        {summary ? (
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</div>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </>
  );
}
