---
name: ui-conventions
description: WealthTrack UI rules — layout shell, money/percent display, forms, tables, charts, badges, empty/loading states, mobile behaviour. Use when building or changing any page or React component.
paths:
  - "src/app/**/*.tsx"
  - "src/components/**"
  - "src/modules/**/components/**"
---

# UI conventions (screens are specified in docs/05-UI-SPEC.md)

- Build with shadcn/ui primitives from `src/components/ui`; shared pieces live in `src/components/shared`.
  Reuse before creating: `Money`, `MoneyInput`, `PercentInput`, `DatePicker`, `AccountSelect`,
  `HoldingSelect`, `AllocationTreeEditor`, `StatCard`, `DataTable`, `EmptyState`, `ConfirmDialog`,
  `StaleBadge`, `TrendChip`, `PageHeader`, `TimeRangeBar`, `BucketBar`.
- **Money:** always render with `<Money valueMinor currency />` (thousands separators, 2 decimals,
  negatives red, respects hide-amounts). Never format money inline. Inputs use `<MoneyInput>` which
  converts to minor units.
- **Percent:** `formatPercentBp` → 1 decimal. Gains green ▲, losses red ▼ via `TrendChip`.
- **Forms:** React Hook Form + zodResolver with the module's Zod schema; inline errors; disable submit
  while pending; toast on success; call server action and handle `ActionResult`.
- **Tables:** TanStack Table via `DataTable`; filters synced to URL search params; stacked cards < 640px.
- **Charts:** Recharts in a client component; class colours from asset classes; tooltips show full
  amounts; respect dark mode via CSS variables.
- **States:** every page has skeleton `loading.tsx`, an `EmptyState` with the primary action, and an
  error boundary.
- **Destructive actions:** `ConfirmDialog` that states the effect (e.g. "Voids 6 transactions and
  restores LKR 50,000 to Sampath Savings").
- **Accessibility:** labels on inputs, keyboard reachable, visible focus, colour never the only signal.
- **Layout:** `PageHeader` (title, description, primary action) → content grid; max width 1400px;
  16px gutter on mobile.
- Keep pages thin: data fetching in `queries.ts`, logic in services.
