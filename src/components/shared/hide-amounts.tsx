"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HIDE_AMOUNTS_STORAGE_KEY } from "@/lib/constants";
import { setHideAmountsAction } from "@/modules/settings/actions";

// Hiding is a DOM attribute (`<html data-hide-amounts>`) that CSS uses to blur every <Money>.
// A pre-paint script in the root layout restores it from localStorage, so amounts never flash.

const listeners = new Set<() => void>();

function readHidden(): boolean {
  return document.documentElement.hasAttribute("data-hide-amounts");
}

function writeHidden(hidden: boolean) {
  document.documentElement.toggleAttribute("data-hide-amounts", hidden);
  try {
    localStorage.setItem(HIDE_AMOUNTS_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // storage unavailable (private mode) — the attribute still applies for this page
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHideAmounts(): boolean {
  return React.useSyncExternalStore(subscribe, readHidden, () => false);
}

/** Aligns the page with the saved setting (it may have changed on another device). */
export function HideAmountsSync({ hidden }: { hidden: boolean }) {
  React.useEffect(() => {
    if (readHidden() !== hidden) writeHidden(hidden);
  }, [hidden]);
  return null;
}

export function HideAmountsToggle({ className }: { className?: string }) {
  const hidden = useHideAmounts();
  const label = hidden ? "Show amounts" : "Hide amounts";

  async function toggle() {
    const next = !hidden;
    writeHidden(next);
    const result = await setHideAmountsAction({ hideAmounts: next });
    if (!result.ok) {
      writeHidden(!next);
      toast.error(result.error.message);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => void toggle()}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
    >
      {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
    </Button>
  );
}
