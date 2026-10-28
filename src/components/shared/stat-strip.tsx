import { cn } from "@/lib/utils";
import { StatCard, type StatCardProps } from "@/components/shared/stat-card";

// docs/07 §2/§5 — the most important number first, without a screen of full-width cards.
// Phones: the first stat as a hero, the rest as a compact two-column grid.
// md+: the usual grid of StatCards (pass the page's desktop grid classes in `className`).

export interface StatStripProps {
  stats: (StatCardProps & { key?: string })[];
  /** Desktop grid classes, e.g. "md:grid-cols-2 lg:grid-cols-4" (the grid itself is md+ only). */
  className?: string;
}

function Compact({ label, value, hint }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3">
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function StatStrip({ stats, className }: StatStripProps) {
  const [hero, ...rest] = stats;
  return (
    <>
      <div className="grid gap-3 md:hidden">
        {hero ? <StatCard {...hero} /> : null}
        {rest.length ? (
          <div className="grid grid-cols-2 gap-3">
            {rest.map((s, i) => (
              <Compact key={s.key ?? `${s.label}-${i}`} {...s} />
            ))}
          </div>
        ) : null}
      </div>
      <div className={cn("hidden gap-4 md:grid", className)}>
        {stats.map((s, i) => (
          <StatCard key={s.key ?? `${s.label}-${i}`} {...s} />
        ))}
      </div>
    </>
  );
}
