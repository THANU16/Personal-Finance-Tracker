---
name: analytics-charts
description: Build charts, series and time-range analytics for WealthTrack — Recharts components, flows-versus-stocks aggregation, timezone-aware bucketing, gap filling, compare-to-previous-period, TimeRangeBar URL state, snapshot cache, fixed asset-class colours. Use whenever adding or changing a chart, a dashboard widget, a report series or any Day/Week/Month/Custom range logic, even if the user does not say "analytics".
paths:
  - "src/modules/dashboard/**"
  - "src/modules/reports/**"
  - "src/modules/snapshots/**"
  - "src/domain/series.ts"
  - "src/domain/date-range.ts"
  - "src/components/charts/**"
---

# Analytics & charts

Read docs/04 §2, §4, §16, §22 and docs/05 first. Rules:
- Flows (income, expense, invest, SIP) are SUMMED per bucket; stocks (net worth, assets, liabilities, allocation, balances) take the CLOSING
  value of the bucket, carried forward across empty buckets. Return every bucket in the range.
- Bucket in the user's timezone (Asia/Colombo default), week starts Monday. Aggregations use $dateTrunc with timezone; pure bucket helpers live in
  domain/date-range.ts and are unit tested (23:30 local, month boundaries, week boundary).
- Default granularity ≤31 days day, ≤183 week, else month; user override allowed; warn above 400 buckets.
- compare = equal-length previous period aligned by bucket, with total and % change.
- Net worth series = one pass over sorted events (computeNetWorthSeries); FDs use the §9 formula as of each date; monthly snapshots are only a
  cache for month granularity over long ranges. A series point must equal computeNetWorthAsOf for the same date (test it).
- Range state lives in the URL (?from=&to=&g=&cmp=) via useTimeRange(); server components read searchParams; do not hold range in component state.
- Cashflow excludes transfers (except their fee), invest, redeem, debt principal, adjustments (docs/04 §4). Savings rate per bucket = (income −
  expense) / income, null when income is 0.
- Charts: Recharts client components, fixed class colours from assetClasses.color, validated series tokens for single/dual series, crosshair tooltip with
  full amounts and delta vs previous bucket, compact axis ticks, savings-rate on a right axis, aria summary text, horizontal scroll above ~30 bars on
  mobile. Every widget has skeleton, empty and error states and sits behind Suspense (cacheComponents).
- No business maths in components: queries return ready-to-plot values.
Checklist: gap-filled, correct flow/stock handling, timezone passed, compare works, tests cover boundaries, empty/loading/error present.
