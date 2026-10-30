"use client";

import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";

/**
 * docs/07 §7 — registers /sw.js (production only: in development it would cache dev chunks).
 * The worker caches build assets only; pages and data always come from the network.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined);
  }, []);
  return null;
}

/** docs/07 §6 — shown while the device is offline; nothing can be saved until it is back. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      You&apos;re offline — changes can&apos;t be saved.
    </div>
  );
}
