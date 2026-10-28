# Mobile Progress

| Phase | Status | Date | Commit |
|---|---|---|---|
| M0 Mobile audit | ✅ | 2026-10-29 | 06c6802 |
| M1 Foundation & shell | ✅ | 2026-10-29 | feat(mobile-M1) |
| M2 Component kit | ⬜ | | |
| M3 Home & Quick add | ⬜ | | |
| M4 Activity & Accounts | ⬜ | | |
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

## Deviations from docs
- M0: `/transactions/import/money-manager/[batchId]` has no screenshot (the demo data has no import
  batch). Proposed for M4: upload the e2e Money Manager fixture during `npm run screens`.

## Open questions for the owner
- Approve the plan changes in `docs/MOBILE-AUDIT.md` §4 (M2 primitive sizes, chart mobile mode, stat
  strip, `DataTable` breakpoint `sm`→`md`; Money Manager capture in M4; Quick add "Debt pay").
- ESS-01: the essentials insurance table also scrolls the page 75px sideways at 1440. Fixing it
  changes desktop rendering — OK to fix in M7?
- OPP-03: `/opportunity-fund` logs a server→client serialisation error (not a mobile issue). Fix it
  now as a separate change, or later?

## Known issues
- Dev-only: the Next dev-tools badge appears bottom-left over the tab bar in screenshots.
- Base UI `nativeButton` warning remains on 8 pages (other `Button render={<Link>}` uses); X-17.
- Detail pages still show their in-page "← Accounts"/"← Assets" link under the new top-bar back
  chevron (ACC-03, HLD); removed in their page phases.
- Sub-pages (`/sip/history`, `/sip/plans/new`, `/assets/update-values`, `/assets/import-valuations`,
  `/transactions/import`) and detail pages are 3 taps from the tab bar (section + one in-page link).
