# 07 — Mobile UX Specification (installed iPhone/Android web app)

The same Next.js app serves desktop and mobile. Below 768px (`md` breakpoint) the app switches to the
mobile layout described here. No separate codebase, no duplicated business logic: only layout and
components change. Desktop must look and behave exactly as before.

The app is mostly used from the home-screen icon (standalone mode), one-handed, often to log a
quick expense or execute a SIP. Optimise for: **log in 3 taps, read the key number in 1 second,
never pinch-zoom, never scroll sideways.**

## 1. Shell
- **Bottom tab bar** (fixed, 5 slots, icons + labels, 56px + safe-area inset):
  `Home` (dashboard) · `Activity` (transactions) · **`+` (centre, raised: Quick add)** · `Invest`
  (assets hub) · `More`.
- **Invest hub** = segmented control at the top: Assets · SIP · Rebalance · Opp. Fund.
- **More** = grouped list (iOS settings style): Accounts, Recurring, Budgets, Goals, Debts,
  Essentials, Forecast, Reports, Notifications, Settings, Log out.
- **Top bar** (compact): page title (large title that collapses on scroll), back chevron on detail
  pages, at most 2 icon actions on the right (e.g. hide amounts, notifications bell with badge).
- Hide the desktop sidebar entirely below `md`.
- Respect safe areas: `viewport-fit=cover` and `env(safe-area-inset-*)` padding on the top bar,
  tab bar, bottom sheets and sticky action bars (notch + home indicator).
- Standalone detection (`display-mode: standalone`) → no browser chrome assumptions; provide an
  in-app refresh (pull-to-refresh on lists or a refresh action), because standalone iOS has no reload button.

## 2. Layout rules
- Single column. 16px side padding. Cards full width with 12px gap.
- **No horizontal page scroll anywhere.** Wide content (tables, schedules) becomes card lists.
- Minimum touch target 44×44px; 8px spacing between tappable items.
- Text: body 16px, secondary 14px, never below 12px. Numbers use tabular figures.
- Primary actions in the **thumb zone**: sticky bottom action bar on forms and detail pages
  ("Save", "Execute SIP"), above the home indicator. No primary buttons only at the top.
- Long pages get section headers and collapsible groups; show the most important number first.

## 3. Component patterns (mobile variants)
| Desktop | Mobile |
|---|---|
| Data table | Card list: title + subtitle left, amount right, meta row below; swipe or `⋯` for actions |
| Dialog / modal | **Bottom sheet** (shadcn Drawer / vaul) with drag handle; full-height for long forms |
| Dropdown select with many items | Bottom-sheet picker with search (accounts, categories, holdings) |
| Hover tooltip | Tap to reveal (popover) — no hover-only information |
| Filters bar | "Filter" chip → bottom sheet; active filters as removable chips under the title |
| Tabs with many items | Horizontally scrollable segmented chips (the only allowed horizontal scroll) |
| Multi-column forms | One field per row, label above input |
| Side-by-side charts | Stacked; each chart full width, 200–240px tall, simplified axes |
| Context menus | Action sheet (bottom sheet list) |

## 4. Forms & input (iOS specifics)
- Inputs font-size ≥ 16px (prevents iOS auto-zoom on focus).
- Money: `inputmode="decimal"`, large right-aligned amount, currency prefix, thousands separators
  while typing. Percent: `inputmode="decimal"`. Dates: native date input or a sheet calendar.
- `enterkeyhint="next"` / `"done"`; Enter moves to the next field; the last field submits.
- Keyboard must not cover the focused field or the sticky action bar (use `visualViewport`).
- Remember last-used account/category in Quick add; default date = today.
- Validation errors inline under the field; scroll + focus the first error.

## 5. Key screens on mobile
- **Home:** net worth hero (big number, Δ this month chip, hide toggle) → mini trend sparkline →
  "Needs attention" stack (SIP due with **Execute** button, bills due, stale values, opportunity
  banner) → This month (income / expense / savings rate) → allocation donut (compact, legend as
  list) → goals → essentials.
- **Quick add (+):** full-screen sheet. Type chips at top (Expense · Income · Transfer · Invest ·
  Redeem · Inv. income · Debt pay). Huge amount field focused first, then category grid (recent
  first), account, date, note. One "Save" in the sticky bar. "Save & add another".
- **Activity:** grouped by day with day totals; search at top; filter chip sheet; tap row → detail
  sheet with Edit / Duplicate / Void.
- **Assets:** totals card; class sections collapsible; holding rows (name, value, gain % chip,
  stale badge). Holding detail: header numbers, chart, actions as a 3-button row
  (Buy · Redeem · Update value), tabs as segmented control.
- **Update values (bulk):** one card per holding with last value, last updated and a large input;
  sticky "Save all (n changed)".
- **SIP execute:** stepper by class; each asset a card with planned vs actual input (pre-filled),
  optional units/price behind "More"; sticky footer with total, status preview and "Confirm".
- **Rebalancing:** drift as horizontal bars per class (tap to expand assets); plan as card list.
- **Opportunity Fund:** banner on top, drawdown gauge, rule ladder list, "Record deployment" sheet.
- **Debts:** loan cards with progress; schedule as a list grouped by year (collapsible).
- **Reports / Forecast:** one chart per card; tables become lists; export via share sheet.
- **Settings:** grouped list rows that push to sub-pages.

## 6. Feedback & states
- Skeletons matching the card layout; never blank screens.
- Optimistic UI only for non-financial toggles (read/unread). Money writes wait for the server.
- Toasts appear above the tab bar. Destructive confirmations use an action sheet with a red action.
- Empty states with one clear primary action.
- Offline: banner "You're offline — changes can't be saved". Read-only cached shell is fine; no
  offline writes in this version.

## 7. PWA polish
- `manifest.webmanifest`: name, short_name, `display: standalone`, theme/background colours for
  light and dark, icons 192/512 + maskable; `apple-touch-icon` 180px; `apple-mobile-web-app-capable`,
  status-bar style, app title.
- iOS splash/launch: background colour matches theme to avoid a white flash.
- Service worker: cache the app shell and static assets; network-first for data; never cache
  authenticated API/data responses across users.
- Session persists long enough that the user rarely re-logs in (Better Auth session expiry setting).
- Optional: Web Push for reminders (supported for home-screen web apps on recent iOS versions);
  permission requested from a settings toggle, never on first launch.

## 8. Performance
- First load on 4G < 3s; route transitions feel instant (prefetch tab routes, `loading.tsx`
  skeletons). Lazy-load charts. Images/icons optimised. Avoid layout shift (reserve chart heights).

## 9. Accessibility
- Respect Dynamic Type-like scaling (rem units), `prefers-reduced-motion`, dark mode, colour
  contrast AA, VoiceOver labels on icon buttons, focus order matches visual order.

## 10. Test viewports
iPhone SE (375×667), iPhone 15 (393×852), iPhone 15 Pro Max (430×932), small Android (360×800),
plus desktop 1440×900 to prove nothing regressed.
