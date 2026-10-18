// Temporary stand-in for routes that later phases build (docs/06-BUILD-PLAN.md).
export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase {phase}.</p>
    </main>
  );
}
