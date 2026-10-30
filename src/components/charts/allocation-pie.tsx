"use client";

import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Amount, TooltipRow, TooltipShell } from "@/components/charts/chart-kit";
import { formatPercentBp } from "@/lib/format";
import { vizColor } from "@/lib/viz-palette";
import type { Allocation } from "@/modules/dashboard/queries";

/** The donut itself (Recharts), loaded lazily by `AllocationDonut`; a slice opens Assets. */
export function AllocationPie({
  classes,
  currency,
}: {
  classes: Allocation["classes"];
  currency: string;
}) {
  const router = useRouter();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={classes}
          dataKey="valueMinor"
          nameKey="name"
          innerRadius="62%"
          outerRadius="100%"
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={false}
          onClick={(_, index) => {
            const c = classes[index];
            if (c) router.push(`/assets?class=${c.id}`);
          }}
          className="cursor-pointer"
        >
          {classes.map((c) => (
            <Cell key={c.id} fill={vizColor(c.color)} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            const c = active
              ? (payload?.[0]?.payload as (typeof classes)[number] | undefined)
              : undefined;
            if (!c) return null;
            return (
              <TooltipShell title={c.name}>
                <TooltipRow
                  color={vizColor(c.color)}
                  label={formatPercentBp(c.shareBp)}
                  value={<Amount minor={c.valueMinor} currency={currency} />}
                />
              </TooltipShell>
            );
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
