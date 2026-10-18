"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { Granularity, RangePreset } from "@/domain/date-range";

/**
 * Range state lives in the URL (?r=&from=&to=&g=&cmp=) so a reload or a shared link restores the
 * view; server components read searchParams. Updates use replace() and keep scroll.
 */
export function useTimeRange() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  return {
    pending,
    /** A preset clears a custom range and a pinned granularity (it picks its own default). */
    setPreset: (preset: Exclude<RangePreset, "custom">) =>
      update({ r: preset, from: null, to: null, g: null }),
    setCustom: (from: string, to: string) => update({ r: "custom", from, to, g: null }),
    setGranularity: (g: Granularity) => update({ g }),
    setCompare: (on: boolean) => update({ cmp: on ? "1" : null }),
  };
}
