"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

// docs/07 §3 — no hover-only information: on phones the ⓘ opens a popover on tap; md+ keeps the
// hover tooltip.

export interface InfoTipProps {
  /** Accessible name of the ⓘ button, e.g. "About safe to spend". */
  label: string;
  children: ReactNode;
}

export function InfoTip({ label, children }: InfoTipProps) {
  const isMobile = useIsMobile();
  const icon = <Info className="size-4" aria-hidden />;
  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger
          aria-label={label}
          className="-m-3.5 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground"
        >
          {icon}
        </PopoverTrigger>
        <PopoverContent className="max-w-[calc(100vw-2rem)] text-sm">{children}</PopoverContent>
      </Popover>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className="inline-flex items-center text-muted-foreground hover:text-foreground"
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  );
}
