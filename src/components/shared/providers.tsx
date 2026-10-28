"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

// docs/07 §6 — on phones toasts sit just above the tab bar (and the home indicator).
const ABOVE_TAB_BAR = "calc(5.5rem + env(safe-area-inset-bottom))";

export function Providers({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <Toaster
          richColors
          position={isMobile ? "bottom-center" : "top-right"}
          offset={isMobile ? { bottom: ABOVE_TAB_BAR } : undefined}
          mobileOffset={{ bottom: ABOVE_TAB_BAR, left: 16, right: 16 }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
