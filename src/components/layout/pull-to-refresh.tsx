"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

// docs/07 §1 — the installed (standalone) app has no browser reload button, so pulling down at the
// top of a page re-fetches its server data. Phones only; the More page also has "Refresh data".

const TRIGGER_PX = 64;
const MAX_PX = 96;
const STANDALONE = "(display-mode: standalone)";

function subscribeStandalone(onChange: () => void) {
  const mql = window.matchMedia(STANDALONE);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia(STANDALONE).matches;
}

/** A pull must start on the page itself, not in an overlay or a scrolled inner area. */
function canStartPull(target: EventTarget | null): boolean {
  if (window.scrollY > 0 || !(target instanceof Element)) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) {
    return false;
  }
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  return true;
}

export function PullToRefresh() {
  const isMobile = useIsMobile();
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, startRefresh] = useTransition();
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const enabled = isMobile && standalone;

  useEffect(() => {
    if (!enabled) return;
    const onStart = (e: TouchEvent) => {
      startY.current = canStartPull(e.target) ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      pullRef.current = dy > 0 ? Math.min(dy / 2, MAX_PX) : 0;
      setPull(pullRef.current);
    };
    const onEnd = () => {
      if (startY.current !== null && pullRef.current >= TRIGGER_PX) {
        startRefresh(() => router.refresh());
      }
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, router]);

  if (!enabled) return null;
  const visible = refreshing || pull > 0;
  const offset = refreshing ? TRIGGER_PX / 2 : pull / 2;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center md:hidden"
      style={{
        top: "calc(env(safe-area-inset-top) + 3.5rem)",
        opacity: visible ? Math.min(1, refreshing ? 1 : pull / TRIGGER_PX) : 0,
        transform: `translateY(${offset}px)`,
      }}
    >
      <span className="flex size-10 items-center justify-center rounded-full border bg-background shadow-md">
        <RefreshCw
          className={cn("size-5", refreshing && "animate-spin motion-reduce:animate-none")}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          aria-hidden
        />
        <span className="sr-only">{refreshing ? "Refreshing" : ""}</span>
      </span>
    </div>
  );
}
