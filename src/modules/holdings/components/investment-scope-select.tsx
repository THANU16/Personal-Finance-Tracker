"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ResponsiveSelect, type PickerOption } from "@/components/shared/mobile/responsive-select";

/** Assets page chart filter (docs/04 §24.6): the whole portfolio, one class or one holding (`?chart=`). */
export function InvestmentScopeSelect({
  value,
  classes,
  holdings,
}: {
  value: string;
  classes: { id: string; name: string }[];
  holdings: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const options: PickerOption[] = [
    { value: "all", label: "All investments" },
    ...classes.map((c) => ({ value: `class:${c.id}`, label: c.name, group: "Asset classes" })),
    ...holdings.map((h) => ({ value: `holding:${h.id}`, label: h.name, group: "Holdings" })),
  ];
  return (
    <ResponsiveSelect
      id="investment-chart-scope"
      value={value}
      options={options}
      title="Show"
      className="w-full sm:w-56"
      onValueChange={(v) => {
        const next = new URLSearchParams(params.toString());
        if (v === "all") next.delete("chart");
        else next.set("chart", v);
        const qs = next.toString();
        startTransition(() =>
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
        );
      }}
    />
  );
}
