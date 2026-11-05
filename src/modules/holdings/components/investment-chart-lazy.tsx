"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// docs/07 §8 — Recharts loads after the page, in a placeholder of the chart's height (legend row
// + plot), so nothing moves when it arrives.
export const InvestmentChart = dynamic(
  () => import("@/modules/holdings/components/investment-chart").then((m) => m.InvestmentChart),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-2" aria-busy="true">
        <div className="h-5" />
        <Skeleton className="h-60 w-full rounded-lg" />
      </div>
    ),
  },
);
