# Mobile Progress

| Phase | Status | Date | Commit |
|---|---|---|---|
| M0 Mobile audit | ✅ | 2026-10-29 | 06c6802 |
| M1 Foundation & shell | ✅ | 2026-10-29 | 0d763b6 |
| M2 Component kit | ✅ | 2026-10-29 | 27a0b7e + 3b357b8 |
| M3 Home & Quick add | ✅ | 2026-10-29 | 01c0dfd |
| M4 Activity & Accounts | ✅ | 2026-10-29 | feat(mobile-M4) |
| M5 Assets & valuations | ⬜ | | |
| M6 SIP, Rebalancing, Opportunity Fund | ⬜ | | |
| M7 Remaining pages | ⬜ | | |
| M8 PWA, performance, a11y, QA | ⬜ | | |

Status values: ⬜ not started · 🟡 in progress · ✅ done

## Decisions
- **M0 — screenshots run against an in-memory database, not Atlas.** docs/08 M0 says to log in as the
  seeded user from `.env.local` (`E2E_EMAIL`/`E2E_PASSWORD`), but those keys do not exist and
  `npm run seed` writes to the Atlas cluster in `MONGODB_URI`. `npm run screens` instead starts an
  in-memory replica set + `next dev` on port 3200 (pattern of `scripts/e2e-server.ts`), registers a
  throwaway user and loads the onboarding demo data (same 18-month dataset as `npm run seed`). No
  credentials needed; Atlas is never touched. `next dev` (not `next start`) because "Load demo data"
  is disabled in production builds.
- **M0 — overlays are captured too.** Besides every route, the run opens Quick add, the Add account
  dialog and (mobile only) the More menu and saves them as `screens/<viewport>/@<name>.png`.
- **M0 — check rules.** Tap targets: visible `a[href]`, buttons, inputs, selects, summaries and
  interactive ARIA roles smaller than 44×44; inputs: font-size < 16px; sr-only and Base UI hidden
  form inputs are ignored. Overflow lists the outermost offending elements, ignoring fixed bars
  (they only stretch to the widened viewport); if none is found it lists the rightmost elements.
- **M0 — filtered runs merge** into the existing `screens/report.json`; a full run replaces `screens/`.

- **M1 — Invest hub label "Allocation"** (not docs/07's "Rebalance"), matching the sidebar and the
  page title. Owner decision, 2026-10-29.
- **M1 — what moved off the phone top bar:** Add → tab-bar `+`; theme → More › App › Theme; account
  name/email and Log out → More. The phone bar keeps hide-amounts and notifications (docs/07: ≤ 2).
  The disabled "Search (coming soon)" box is hidden below md (it showed from 640px before).
- **M1 — large-title collapse** reads the page's own `<h1>`: the compact title fades in when the
  h1 scrolls under the bar, so no per-page title config is needed. Back targets come from
  `mobileParent()` in `nav.ts` (detail page → its list, More pages → More).
- **M1 — More page** is a real route (`/more`); the desktop sidebar is not rendered below md.
- **M1 — refresh in standalone mode:** pull-to-refresh only when installed (`display-mode:
  standalone`) and on a phone, plus "Refresh data" on More for any mode.
- **M1 — toasts:** bottom-centre above the tab bar below md, top-right from md (unchanged).
- **M1 — iOS status bar style stays `default`.** `black-translucent` would draw white status text
  over the light top bar; dark-mode status bar colour is M8 polish.
- **M1 — screens script:** `@more-menu` replaced by the `/more` route; new `@scrolled-title` overlay
  (scrolls `/accounts`) to capture the collapsed title.
- **M2 — owner approvals (2026-10-29):** global 44px primitives (X-03), chart mobile mode (X-10),
  `StatStrip` (X-11), and converting every dialog at once (not opt-in).
- **M2 — dialogs → bottom sheets in `ui/dialog.tsx`.** Below md `Dialog` uses Base UI's
  `Drawer.Root` and `DialogContent` renders a swipe-down sheet (handle, scrolling body, keyboard
  aware via `Drawer.VirtualKeyboardProvider`, sticky `DialogFooter`). Drawer extends Dialog, so
  Trigger/Title/Description/Close are shared and the 26 dialogs needed no module changes. Callers'
  `DialogContent` classes (max-w, max-h, overflow) apply to the desktop dialog only.
  `AlertDialog` (incl. `ConfirmDialog`) is a bottom-anchored action sheet below md (no swipe).
- **M2 — primitive sizes change heights only.** Below md: Button (every size) and icon buttons
  44px, Input/Select trigger 44px (Select text 16px), Tabs triggers ≥ 44px, Dropdown/Select items
  ≥ 44px, Switch hit area 46px, Calendar cells 44px. Padding and text sizes are untouched so callers
  that override them keep their desktop look. Callers that override heights got a matching `md:`
  class (portfolio-view link button, calendar day/nav buttons, Quick add tabs and amount).
- **M2 — `MoneyInput` shows thousands separators while typing on phones only**
  (`src/lib/typing-format.ts`, caret kept after the typed digit); desktop typing is unchanged.
  `size="lg"` is the amount-first field for Quick add.
- **M2 — kit** in `src/components/shared/mobile/`: `ResponsiveSelect` (picker sheet with search),
  `ActionSheet`, `FilterSheet` + `FilterChips`, `StickyActionBar` (above the tab bar, lifted above
  the keyboard via `useKeyboardInset`), `SegmentedControl`, `InfoTip`, `KeyboardSafeForm` (Enter →
  next field, last submits, `enterkeyhint`); `StatStrip` in `src/components/shared/`. Demo:
  `/dev/mobile-kit` (404 in production).
- **M2 — `DataTable`** cards switch at md (was sm). Columns may set `meta.mobile`
  (title/subtitle/amount/meta/actions/hidden) for compact rows; without slots the old label/value
  cards stay.
- **M2 — charts:** `useChartAxes()` in chart-kit; every chart's axes use it (12px labels, money
  ticks without the currency code and a ≤ 48px Y axis on phones; desktop identical).
- **M2 — desktop check:** full-page pixel diff of every desktop screenshot against M1 — identical
  except run-dependent text (notification times, the throwaway user's email).
- **M3 — dashboard phone order with CSS only.** Each widget sits in a `Slot` (`order-N` below md,
  `display: contents` from md) and the desktop row wrappers are `contents` below md, so on phones
  every widget is a grid item placed by `order` while desktop keeps its exact grids. Order: hero →
  Needs attention → where my cash is → income vs expense → allocation → goals → essentials →
  opportunity → net worth trend → top categories → assets vs liabilities.
- **M3 — hero** (phones): net worth in full, ▲/▼ change chip for this month, hide-amounts toggle,
  sparkline of the range's net worth series, a 3-up strip (assets, liabilities, savings rate) and
  the standing summary folded under "More numbers". The series is computed once per request
  (`cache()` around `netWorthSeries` shared with the trend and assets-vs-liabilities cards).
- **M3 — Needs attention** (phones) merges Upcoming (14 days) and Attention into two-line rows with
  one action each, linking to the page that already does it: SIP period generated → **Execute**
  (filled), projected → View; recurring → Confirm; card due / EMI → Pay; FD maturity → View; budgets
  / drift → Review; stale values → Update; market drop → Deploy. Desktop keeps both cards.
- **M3 — range bar** (phones): presets in one sideways-scrolling row; Day/Week/Month and Compare
  behind an "Options" chip (`FilterSheet` with `label`); desktop inline as before.
- **M3 — Quick add** (phones): full-height bottom sheet (`DialogContent mobileLayout="fill"`), type
  chips in one row, amount first (`MoneyInput size="lg"`), recent-categories grid (last 8 per
  kind, stored on the device: `wt-quick-add-categories`), account and category pickers as search
  sheets, template picker moved to the end (rendered there, so focus order matches), Save + "Save &
  add another" (keeps type, accounts and date; detected from the form's submitter button).
- **M3 — Debt pay** (owner decision): a chip in Quick add lists loan accounts; choosing one opens
  `/debts/by-account/[accountId]` (thin page using the existing `getDebtForAccount`) which redirects
  to `/debts/<id>?pay=1`, where Record payment opens. No new transaction logic.
- **M3 — `CategorySelect`** is a grouped picker sheet with search on phones (every category field).
- **M3 — layout lesson:** a sideways-scrolling row placed directly in a height-constrained grid
  collapses to 0 (scroll containers have no automatic minimum height). Wrap the scroller in a plain
  block with `min-w-0`.
- **M3 — desktop check:** pixel diff of every desktop screenshot against M2 — identical except
  run-dependent text (notification times, throwaway email).
- **M4 — day totals** (owner decision): `src/lib/day-groups.ts` (unit tested) groups the rows on
  the page by day and sums what is shown: ledger view = income − expense in the base currency
  (transfers, investments and voids count 0; another currency marks the day "+ other
  currencies"); account view = the effect on the account. Display only, current page only.
- **M4 — Activity** (phones): `TransactionsTable` renders `TransactionDayList` below md (sticky day
  headers, two-line rows); a row opens a detail sheet with the same Edit / Duplicate / Attachments /
  Void handlers (`TransactionRowActions layout="buttons"`). The same list serves account detail
  (running balance) and holding tabs. Ledger cells moved to `ledger-cells.tsx`.
- **M4 — filters** (phones): search + "Filter (n)" sheet with the same controls + removable chips;
  desktop markup unchanged (the old phone-only toggle is gone).
- **M4 — accounts** (phones): earmark bar / card details on a full-width line under the row
  (fixes the overlap); account names have a 44px hit area; detail page shows Add transaction + ⋯
  (Reconcile / Edit / Archive), hides the in-page back link, earmarks header stacks.
- **M4 — imports** (phones): bank CSV column mapping as a "column → first value" list, rows to
  import as cards with a 44px category select, sticky Import button; Money Manager wizard tables use
  `stackOnPhone` (`src/components/shared/mobile/stack-table.ts`: rows become wrapped lines below md).
  `npm run screens` uploads the e2e Money Manager fixture so the wizard is captured.
- **M4 — don't render content twice for phone vs desktop** (screen readers and e2e locators see
  both copies — a ledger test found "12.0% used" twice). Move one element with layout instead: the
  account row's details use `max-md:contents` on the middle column + `max-md:order-last
  max-md:basis-full`, so the same node sits under the name on desktop and on its own line on phones.
- **M4 — `buttonVariants()` merges its classes** (tailwind-merge), so links styled as buttons look
  exactly like `<Button>` (an outline link had lost its border). Link buttons on the touched pages
  are now real links (`Link` + `buttonVariants`), which removes the Base UI `nativeButton` warning.

## Deviations from docs
- M3: Quick add keeps "Paid from"/"Received into" before Category (DOM order kept so keyboard
  focus follows the screen); docs/07 lists category before account. The recent-categories grid
  keeps the expense at ≤ 3 taps after the amount.
- M0: `/transactions/import/money-manager/[batchId]` has no screenshot (the demo data has no import
  batch). Proposed for M4: upload the e2e Money Manager fixture during `npm run screens`.

## Open questions for the owner
- ESS-01: the essentials insurance table also scrolls the page 75px sideways at 1440. Fixing it
  changes desktop rendering — OK to fix in M7?
- OPP-03: `/opportunity-fund` logs a server→client serialisation error (not a mobile issue). Fix it
  now as a separate change, or later?

## Known issues
- Screenshot runs on `next dev` can log a hydration warning about `caret-color: transparent` on a
  focused input: Playwright hides the caret while the page is still hydrating. Not an app issue.
- Pre-existing, date-dependent e2e failure (not mobile): `tests/e2e/allocation.spec.ts` "Tilt next
  period" fails on the 29th–31st. A new SIP plan defaults to day `min(28, today)` starting today, so
  its first period is ~30 days out, beyond `GENERATE_AHEAD_DAYS = 7`; no `due` execution exists and
  the rebalance panel shows "No SIP plan has an upcoming period". Fix belongs in the test (set the
  day) or a product decision on the default day — owner to decide.
- The screens check counts Switch (32×18) and checkbox/radio controls as small: their 44px touch
  area is a pseudo-element the check cannot measure.
- Dev-only: the Next dev-tools badge appears bottom-left over the tab bar in screenshots.
- Base UI `nativeButton` warning remains on 8 pages (other `Button render={<Link>}` uses); X-17.
- Detail pages still show their in-page "← Accounts"/"← Assets" link under the new top-bar back
  chevron (ACC-03, HLD); removed in their page phases.
- Sub-pages (`/sip/history`, `/sip/plans/new`, `/assets/update-values`, `/assets/import-valuations`,
  `/transactions/import`) and detail pages are 3 taps from the tab bar (section + one in-page link).
