"use client";

import type { ComponentProps } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";

// docs/07 §2 — primary actions in the thumb zone. Wraps an existing action row: md+ keeps the
// row's own classes untouched (desktop identical); below md the row is pinned above the tab bar
// (or the keyboard while it is open) and a spacer keeps the end of the page reachable.
// Use StickyActionBar for new screens; this is for rows whose desktop layout must not change.

const PINNED =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-30 max-md:border-t max-md:bg-background/95 max-md:px-4 max-md:py-3 max-md:backdrop-blur";

export function PinnedOnPhone({ className, style, children, ...props }: ComponentProps<"div">) {
  const isMobile = useIsMobile();
  const keyboard = useKeyboardInset();
  return (
    <>
      <div
        {...props}
        data-slot="pinned-on-phone"
        style={isMobile && keyboard > 0 ? { ...style, bottom: keyboard } : style}
        className={cn(className, PINNED)}
      >
        {children}
      </div>
      <div aria-hidden className="h-20 md:hidden" />
    </>
  );
}
