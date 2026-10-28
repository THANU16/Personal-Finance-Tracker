# 08 — Mobile Build Plan

Run one phase per session: `/mobile-phase <n>`, then `/clear`. Every phase ends with
`npm run verify` green, mobile screenshots re-taken, `docs/MOBILE-PROGRESS.md` updated, and a commit
`feat(mobile-<n>): …`. **Desktop must not change** — the screenshot check includes 1440×900.

Work against the **local dev server with seed data** (`npm run seed`), never against production data.

---

## Phase M0 — Mobile audit (no UI changes)
**Prompt**
```
Mobile phase M0: audit only, do not change UI code. Read docs/07-MOBILE-UX.md.
1. Create scripts/mobile-screens.ts (Playwright, run with `npm run screens`): start from the
   seeded demo user (credentials from .env.local E2E_EMAIL / E2E_PASSWORD), log in, visit every
   route in src/app/(app) (resolve [id] routes with the first seeded record), and save full-page
   screenshots for each viewport in docs/07 §10 to screens/<viewport>/<route>.png
   (screens/ is git-ignored). Also record per page: horizontal overflow (scrollWidth > clientWidth),
   tap targets smaller than 44px, inputs with font-size < 16px, and console errors → screens/report.json.
2. Look at every screenshot yourself and write docs/MOBILE-AUDIT.md: per page a table of issues
   (severity High/Med/Low, what's wrong, which docs/07 rule it breaks, proposed fix), plus a
   cross-cutting list (shell, navigation, tables, dialogs, forms, charts).
3. Map each issue to phases M1–M8 below; adjust the plan if something is missing and tell me.
```
**Acceptance:** screenshots for all routes × 5 viewports; MOBILE-AUDIT.md reviewed by me before M1.

## Phase M1 — Mobile foundation & shell
```
Mobile phase M1. Implement docs/07 §1, §2, §7 basics: viewport-fit=cover + safe areas, useIsMobile
/ md breakpoint conventions, bottom tab bar (Home, Activity, +, Invest, More), Invest hub
segmented control, More page, compact top bar with large-title collapse and back navigation,
hide sidebar < md, toasts above tab bar, refresh action for standalone mode, manifest/apple meta
tags and icons. Desktop unchanged.
```
**Acceptance:** every route reachable within 2 taps from the tab bar; no overflow on any page shell.

## Phase M2 — Mobile component kit
```
Mobile phase M2. Build responsive primitives in src/components/shared/mobile/ and make existing
shared components adapt (docs/07 §3, §4): ResponsiveDialog (Dialog ≥ md, bottom-sheet Drawer < md),
ResponsiveSelect/Picker sheet with search, ActionSheet, CardList (renders DataTable ≥ md and card
rows < md from the same column definitions), FilterSheet + filter chips, StickyActionBar,
SegmentedControl, mobile MoneyInput (inputmode decimal, live separators, ≥16px), keyboard-safe
form container. Add a /dev/mobile-kit page (dev only) showing every component.
```
**Acceptance:** kit page works at 375px; unit tests for the money input formatting.

## Phase M3 — Home (dashboard) & Quick add
```
Mobile phase M3. Mobile layouts for /dashboard and the Quick add flow per docs/07 §5 (Home,
Quick add): net worth hero, needs-attention stack with inline Execute/Confirm, compact charts,
full-screen Quick add sheet with type chips, amount-first, recent categories grid, remembered
account, Save & add another.
```
**Acceptance:** log an expense in ≤ 3 taps after typing the amount; dashboard readable without zoom.

## Phase M4 — Activity (transactions) & Accounts
```
Mobile phase M4. Mobile /transactions (day-grouped list, search, filter sheet, detail sheet with
edit/duplicate/void), transaction forms in sheets, CSV import steps as a mobile wizard, /accounts
and account detail as card lists with grouped subtotals and reconcile sheet.
```

## Phase M5 — Assets, holdings, valuations
```
Mobile phase M5. Mobile /assets (class sections, holding rows), holding detail (header, chart,
Buy/Redeem/Update value row, segmented tabs), bulk update values as cards with sticky Save all,
add-holding wizard as steps, valuation CSV import as a mobile wizard.
```

## Phase M6 — SIP, Rebalancing, Opportunity Fund
```
Mobile phase M6. Mobile SIP planner (plan cards, plan editor with a mobile allocation tree
editor: class cards expanding to asset rows, sticky totals bar showing 100% status), SIP execute
stepper with sticky confirm footer, SIP history list + charts; rebalancing drift bars and plan
cards; opportunity fund banner, gauge, rules list and deployment sheet.
```
**Acceptance:** executing a 6-asset SIP on an iPhone SE needs no horizontal scrolling and no zoom.

## Phase M7 — Debts, Recurring, Budgets, Goals, Essentials, Forecast, Reports, Notifications, Settings
```
Mobile phase M7. Mobile layouts for all remaining pages per docs/07 §5: debts (cards, schedule
grouped by year), recurring list with confirm sheet, budgets progress list with month switcher,
goals cards, essentials score + lists, forecast single chart + list, reports one chart per card
with export via share, notifications list with swipe actions, settings as grouped list pages.
```

## Phase M8 — PWA polish, performance, accessibility, final QA
```
Mobile phase M8. docs/07 §6–§9: service worker (shell cache, network-first data, offline banner),
splash/theme colours, session persistence, optional Web Push reminders behind a settings toggle,
performance pass (lazy charts, prefetch tabs, no layout shift), accessibility pass (VoiceOver
labels, reduced motion, contrast). Re-run npm run screens and the audit checks: zero overflow,
zero tap targets < 44px, zero inputs < 16px across all routes. Update docs/MOBILE-AUDIT.md to show
every issue resolved. Add Playwright e2e on the iPhone 15 profile: login → quick add expense →
execute SIP → dashboard.
```
**Acceptance:** audit report clean; e2e green on mobile and desktop; tested on my real iPhone.
