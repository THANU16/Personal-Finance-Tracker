# Mobile Audit (phase M0)

Baseline of every page in `src/app/(app)` against `docs/07-MOBILE-UX.md`, taken before any mobile
work. Later phases mark issues fixed here (Status column: ⬜ open · ✅ fixed in Mx).

## How this was produced
- `npm run screens` (`scripts/mobile-screens.ts`) starts an in-memory MongoDB replica set and
  `next dev` on port 3200, registers a throwaway user and loads the onboarding demo data (the same
  18-month dataset as `npm run seed`). Atlas is never touched.
- Viewports (docs/07 §10): `iphone-se-375` (375×667), `iphone-15-393`, `iphone-15-pro-max-430`,
  `android-360`, `desktop-1440`. Mobile viewports use touch + `isMobile` at 2× DPR.
- Output: `screens/<viewport>/<route>.png` (full page) and `screens/report.json`. Overlays that a
  route screenshot cannot show are captured at viewport size: `@quick-add`, `@add-account-dialog`,
  `@more-menu` (mobile only).
- Automated checks per page: horizontal overflow (`scrollWidth > clientWidth`, with the offending
  elements), tap targets < 44×44px, inputs/selects/textareas with font-size < 16px, console errors.
  Visually hidden helpers (sr-only inputs, Base UI hidden form inputs) are excluded.
- Re-run a subset: `npm run screens -- --routes=dashboard,quick-add --viewports=iphone-se-375`
  (routes without the leading slash). A filtered run merges into the existing report.
- Every 375px screenshot was reviewed by eye; 393/430/360 were checked through the report numbers
  (same layout, same issues) and 1440 is the desktop baseline.

**Caveats.** Screenshots come from `next dev`, so the Next dev-tools badge ("N · 1 Issue") sits
bottom-left over the tab bar; it does not exist in production. Full-page captures stitch the fixed
bottom nav into the middle of tall pages. `/transactions/import/money-manager/[batchId]` was not
captured: the demo data has no import batch (see §4).

**Severity.** High = content or actions unreachable, horizontal page scroll, or overlapping text.
Med = breaks a docs/07 rule but usable. Low = polish.

## 1. Summary (375px unless noted)

| Route | Overflow 375 / 393 / 430 / 360 / 1440 (px) | Taps < 44px | Inputs < 16px | Worst | Phase |
|---|---|---|---|---|---|
| /dashboard | 0 / 0 / 0 / 0 / 0 | 43 | 0 | Med | M3 |
| /onboarding | 0 | 10 | 1 | Low | M7 |
| /transactions | 0 | 44 | 0 | Med | M4 |
| /transactions/import | 0 | 8 | 0 | Low | M4 |
| /transactions/import/money-manager/[batchId] | captured from M4 (fixture upload) | – | – | Med | M4 ✅ |
| /accounts | 0 | 26 | 0 | **High** | M4 |
| /accounts/[id] | 0 | 62 | 0 | Med | M4 |
| /assets | 0 | 23 | 0 | Med | M5 |
| /assets/[id] | 0 | 34 | 0 | Med | M5 |
| /assets/update-values | **333 / 315 / 278 / 348** / 0 → 0 (M5) | 13 → 0 | 0 | **High** | M5 ✅ |
| /assets/import-valuations | 0 | 6 | 0 | Low | M5 |
| /sip | 0 | 13 | 0 | Med | M6 |
| /sip/plans/new | 0 | 20 | 0 | Med | M6 |
| /sip/plans/[id] | 0 | 24 | 0 | Med | M6 |
| /sip/execute/[executionId] | 0 | 29 | 0 | Med | M6 |
| /sip/history | 0 | 31 | 0 | Med | M6 |
| /rebalancing | 0 | 35 | 0 | Med | M6 |
| /opportunity-fund | 0 | 42 | 0 | **High** | M6 |
| /debts | 0 | 8 | 0 | **High** | M7 |
| /debts/[id] | 0 | 8 | 0 | **High** | M7 |
| /recurring | 0 | 22 | 0 | **High** | M7 |
| /budgets | 0 | 15 | 0 | Low | M7 |
| /goals | 0 | 12 | 0 | Low | M7 |
| /essentials | **300 / 282 / 245 / 315 / 75** | 19 | 0 | **High** | M7 |
| /forecast | 0 | 16 | 0 | **High** | M7 |
| /reports | 0 | 17 | 0 | **High** | M7 |
| /notifications | 0 | 24 | 0 | Med | M7 |
| /settings | 0 | 32 | 0 | Med | M7 |
| @quick-add | 0 | 62 | 0 | Med | M3 |
| @add-account-dialog | 0 | 37 | 0 | Med | M2 ✅ (bottom sheet, sticky footer; 12 small targets left) |
| @more-menu | 0 | 59 | 0 | Med | M1 ✅ (replaced by `/more`, 0 small targets) |

Only two pages scroll sideways at the page level, but many more hide content: tables inside
`overflow-x-auto` wrappers clip columns (and row actions) without any visible scroll hint, which
the overflow check cannot see. Those are listed per page below.

## 2. Cross-cutting issues

| ID | Sev | Area | What's wrong | docs/07 rule | Proposed fix | Phase | Status |
|---|---|---|---|---|---|---|---|
| X-01 | High | Shell / nav | Bottom nav is Dashboard · Transactions · Assets · SIP · More. No raised centre `+`, no Invest hub; SIP takes a slot. | §1 tab bar | Tab bar Home · Activity · `+` · Invest · More; Invest hub segmented control (Assets · SIP · Rebalance · Opp. Fund). | M1 | ✅ M1 |
| X-02 | Med | Shell / nav | "More" opens the desktop sidebar as a left drawer (`@more-menu`): long list, Goals/Debts below the fold, no Log out, no grouped iOS-style rows. | §1 More | Dedicated More page (grouped list incl. Log out); sidebar hidden < md. | M1 | ✅ M1 |
| X-03 | High | Primitives | shadcn sizes are desktop sizes on phones: Button h-8 (32px) / sm h-7 / xs h-6, Select trigger h-8, Input h-8, segmented pills 28px, Switch 18px, topbar icon buttons 32×32. Every page has 8–62 targets < 44px. | §2 44×44 | Responsive sizes on the primitives (`h-11 md:h-8` style), so desktop keeps today's sizes. **Not in the plan yet — add to M2.** | M2 | ✅ M2 (Button/Input/Select/Tabs/menu items 44px below md; Switch hit area 46px via pseudo-element) |
| X-04 | Med | Top bar | Top bar has no title or back button on mobile; right side carries 5 actions (Add, hide amounts, bell, theme, avatar). Page title + description + action buttons then take ~⅓ of the first screen on every page. | §1 top bar (≤ 2 actions, large title, back chevron) | Compact top bar: large title collapsing on scroll, back chevron on detail pages, hide-amounts + bell only; theme and account move to More; Add moves to the tab bar `+`. | M1 | ✅ M1 |
| X-05 | Med | PWA / safe areas | Root `viewport` has no `viewport-fit=cover`; only the bottom nav uses `env(safe-area-inset-bottom)`; top bar, sheets and sticky bars have no insets. Manifest has a single light `background_color`/`theme_color`; no in-app refresh for standalone mode. | §1 safe areas, standalone refresh; §7 | `viewportFit: "cover"`, inset padding on top bar/tab bar/sheets/sticky bars, refresh action, dark-aware theme colours. | M1 (basics), M8 (polish) | 🟡 M1 basics + M2 sheets (safe-area padding, keyboard-aware drawer); dark status bar → M8 |
| X-06 | High | Tables | Only `holdings-table` uses `DataTable`; ~15 modules render raw `<table>`s (recurring, debts, debt schedule, essentials policies, forecast balances, opportunity deployments, reports ×3, update values, imports, FX rates, holding tabs, allocation). On phones they squeeze (3-line names), clip columns and hide row actions. `DataTable` itself switches to cards at `sm` (640px), not `md`. | §2 no sideways scroll, §3 table → card list | `CardList` driven by the same columns (M2), then convert each table in its page phase; move the breakpoint to `md`. | M2 + page phases | 🟡 M2 slots; M4: `stackOnPhone` for small tables (imports), ledger as day list; recurring/debts/forecast/reports/opp-fund in M6–M7 |
| X-07 | Med | Dialogs | 26 components use centred `DialogContent`; on a phone the Add account dialog fills the screen with its submit button below the fold and no drag handle. Quick add is a right-side sheet (75% width). | §3 dialog → bottom sheet | `ResponsiveDialog` (Dialog ≥ md, bottom-sheet Drawer < md, full height for long forms, sticky footer). | M2 (+ adoption per phase) | ✅ M2 (every `Dialog` is a swipe-down bottom sheet below md; `AlertDialog` an action sheet) |
| X-08 | Med | Selects | 30 components use Base UI `Select` popovers; long lists (accounts, categories, holdings, timezone) open as small popovers. | §3 picker sheet with search | `ResponsiveSelect` → bottom-sheet picker with search < md. | M2 | 🟡 M2 built; M3: CategorySelect + Quick add accounts use the picker sheet |
| X-09 | Med | Tabs / segmented | Tab strips wrap onto 2–4 rows (Reports 7 tabs, Allocation 4, Dashboard range bar 9 presets, Quick add types 6, Opp-fund "Pay from") or scroll with the active tab cut off (Settings starts at "…erences"). | §3 scrollable segmented chips | `SegmentedControl` with horizontal scroll + active-tab scroll-into-view; fewer presets on mobile. | M2 | 🟡 M2 built; M3: range presets and Quick add types scroll in one row |
| X-10 | Med | Charts | Charts are full width at ~240px (good), but Y-axis labels like "LKR 600K" take ~25% of the width, "Show table" toggles are 16px tall, legends are hover-ish, tooltips hover-only. | §3 simplified axes, tap not hover; §8 lazy charts | Mobile mode in `chart-kit` (compact tick formatter without currency, fewer ticks, tap tooltips, 44px "Show table"). **Not explicit in the plan — add to M2.** | M2 | ✅ M2 (`useChartAxes`: phone ticks without currency code, 48px Y axis, 12px labels; 44px "Show table") |
| X-11 | Med | Stat cards | Pages open with 3–6 full-width `StatCard`s (Assets 6, Debts 3, Transactions 3, Opp-fund 4, Holding 4, Debt 5) — one to two screens before the content. | §2 most important number first, §5 | Mobile stat strip: hero number + 2-col compact grid (or horizontal snap row). **Add to M2** as a shared pattern. | M2 | 🟡 M2 built; M3: dashboard hero + strip |
| X-12 | Med | Forms | Primary actions sit at the end of long forms (SIP execute "Confirm", SIP plan "Save changes", Allocation "Save target", Settings "Save preferences", Opp-fund "Save fund settings"). Money inputs show raw `21000.00` without separators; amount fields are normal size. | §2 thumb zone, §4 money input | `StickyActionBar` + mobile `MoneyInput` (separators while typing, ≥16px, `inputmode=decimal`). | M2 (+ adoption) | 🟡 M2: `StickyActionBar`, `KeyboardSafeForm`, `MoneyInput` live separators + `size="lg"` built; adoption per page |
| X-13 | Med | Toasts | Toaster is `top-right`: on phones it covers the top bar. | §6 toasts above tab bar | Bottom-center above the tab bar < md, top-right ≥ md. | M1 | ✅ M1 |
| X-14 | Low | Hover-only info | 42 module components use `title=`/Tooltip for extra info (e.g. "Safe to spend ⓘ"); no tap equivalent on touch. | §3 hover → tap popover | Tap popover component; replace per page. | M2 (+ adoption) | 🟡 M2: `InfoTip` built; adoption per page |
| X-15 | Low | Loading states | One `loading.tsx` for the whole `(app)` group; no page-shaped skeletons. | §6 skeletons, §8 | Page skeletons sized like the card layouts. | M8 | ⬜ |
| X-16 | Low | Inline links | Inline text links used as navigation (account names, holding names, "Budgets →", "All goals →") are 16–20px tall. | §2 44px | Make whole rows/cards the link on mobile. | page phases | ⬜ |
| X-17 | Low | Console (all pages) | Base UI warns on every page: a component with `nativeButton` renders a non-`<button>` (seen via `NotificationBell` → `Button render={<Link>}` in the top bar and others). Not a layout issue. | – | Pass `nativeButton={false}` where `Button` renders a link. Fix with the top-bar rework. | M1 | 🟡 M1 bell; M4: transactions, accounts, imports (link buttons → styled links); rest in their phases |

## 3. Per-page issues

### Home — `/dashboard` (M3)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| DASH-01 | Med | Net worth, Assets and Liabilities are three full-width cards; no hero, no Δ chip / hide toggle on the number. | §5 Home hero | Net worth hero (big number, Δ this month chip, hide toggle) + sparkline. **✅ M3** |
| DASH-02 | Med | "Attention" and "Upcoming" (SIP due, bills) sit at the very bottom (~6 screens down); SIP due has no Execute button. | §5 Needs attention stack | Needs-attention stack directly under the hero with inline Execute/Confirm. **✅ M3** |
| DASH-03 | Med | Time-range bar wraps to 2 rows of 9 presets + granularity + compare switch before any content. | §3 segmented chips | One scrollable chip row; granularity + compare into a filter sheet. **✅ M3** |
| DASH-04 | Low | Upcoming rows truncate names ("Core monthly …", "HNB Visa pay…") because date + amount share the row. | §3 card row | Title/subtitle left, amount right, date in meta row. **✅ M3 (Needs attention rows)** |
| DASH-05 | Low | Income vs expense bars are hair-thin at 375; savings-rate chart is sparse; axis labels wide (X-10). | §3 simplified charts | Monthly buckets on mobile; compact axes. **🟡 M2 axes; bar density open** |
| DASH-06 | Low | Page is ~7 screens long. | §2 collapsible sections | Collapse lower sections (goals, essentials, opportunity) into summary rows. **🟡 M3: summary folded into "More numbers"** |

### Quick add — `@quick-add` (M3)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| QA-01 | Med | Right-side sheet at ~75% width, page visible behind; opened from the top-bar "Add". | §5 full-screen sheet from `+` | Full-screen bottom sheet from the tab-bar `+`. *(M1: opens from the tab-bar `+`; sheet layout still M3.)* **✅ M3** |
| QA-02 | Med | Order is template picker → type chips (wrapping to 2 rows) → amount; amount is a normal-size input, not focused first. | §5 amount-first | Type chips (scrollable) → huge focused amount → category grid → account → date → note. **✅ M3** |
| QA-03 | Med | Category is a select popover; no recent-categories grid; no "Save & add another". Type chips lack "Debt pay". | §5 Quick add | Recent category grid + picker sheet; Save & add another; Debt pay chip (reuses the existing debt payment action — confirm in M3). **✅ M3 (recent grid, picker sheet, Save & add another, Debt pay → loan)** |
| QA-04 | Low | Save is already in a sticky footer (good) but without a safe-area inset. | §1 safe areas | Inset padding. **✅ M3** |

### Activity — `/transactions` (M4)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| TXN-01 | Med | Income / Expense / Net stat cards take the whole first screen. | §2, X-11 | Compact 3-up summary strip. **✅ M4** |
| TXN-02 | Med | List is a flat card list (34 rows) not grouped by day, no day totals; descriptions truncate to ~12 chars ("Bakery & veget…") because amount and `⋯` share the title row. | §5 Activity | Day-grouped list with day totals; amount right, meta row below. **✅ M4 (day groups + day net)** |
| TXN-03 | Med | Search and a filter toggle exist (`transaction-filters.tsx`), but the expanded filters render inline (dates, selects), not as a filter sheet with removable chips. | §3 filters | Keep search on top; Filter chip → sheet; active filters as chips. **✅ M4** |
| TXN-04 | Med | `⋯` row menu is a dropdown, and edit/void open centred dialogs. | §3 action sheet, §5 detail sheet | Tap row → detail sheet with Edit / Duplicate / Void; action sheet for `⋯`. **✅ M4 (detail sheet)** |
| TXN-05 | Low | Header actions (Import, Add transaction) duplicate the `+`. | §1 | Keep Import in a `⋯` menu; `+` covers add. **✅ M4 (Add hidden on phones; Import kept)** |

### `/transactions/import` and Money Manager wizard (M4)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| IMP-01 | Low | Upload step is fine at 375 (single column); "Choose file" is a native file input styled at 14px label. | §4 | Larger file button. **🟡 M4: steps stack; file input 44px (native control)** |
| IMP-02 | ? | `/transactions/import/money-manager/[batchId]` (mapping + review wizard with wide tables) not captured — no seeded batch. Code shows raw tables in `wizard-review-step.tsx` / `wizard-finish-steps.tsx` (X-06). | §2 | Extend `npm run screens` to upload the e2e Money Manager fixture, then audit in M4. **✅ M4 (captured; tables stack on phones)** |

### Accounts — `/accounts`, `/accounts/[id]` (M4)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| ACC-01 | **High** | Account row with earmarks (Commercial Bank): the balance overlaps the earmark bar and legend ("LKR 2,945,959.15" drawn across "Emergency LKR 150,000.00"). | §2 | Row = name/subtitle + amount on one line, earmark bar and legend full width below. **✅ M4** |
| ACC-02 | Med | Names truncate hard ("Commercial …", "Emergency fu…", "Opportunity f…"); card row crowded (limit, % used, outstanding, due). | §3 card list | Two-line rows; card details in meta row. **✅ M4** |
| ACC-03 | Med | Detail: Reconcile / Edit / Archive buttons (32px) at the top; Balance + Opening balance as two full cards; earmark text squeezed beside the "Earmark / move" button. | §2 thumb zone, §5 | Primary action row; reconcile as a sheet; stacked earmark card. **✅ M4 (Add + ⋯; balance cards kept full width)** |
| ACC-04 | Low | Detail transaction list is ~8 screens with pagination at the bottom. | §2 | Day grouping (shared with TXN-02), load more. **✅ M4 (day-grouped list)** |

### Assets — `/assets`, `/assets/[id]` (M5)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| AST-01 | Med | Six stat cards (Value, Invested, Unrealised, Realised, Income, XIRR) before any holding. | X-11, §5 Assets totals card | One totals card. **🟡 M5: six cards in 2 columns (compact values); one totals card not done** |
| AST-02 | Med | Holdings render as stacked label/value blocks (DataTable < sm): ~350px per holding with "Holding / Invested / Value / Gain / Weight / XIRR / Updated" rows. | §5 holding rows | Row: name, value, gain % chip, stale badge; tap → detail. **✅ M5 (DataTable slots)** |
| AST-03 | Low | "By class / All holdings" pills 28px; "Show closed" inline link. | §2 | Segmented control. **✅ M5** |
| HLD-01 | Med | Holding detail actions are Buy / Redeem / Income / Update value (wrapping to 2 rows, 32px). | §5 3-button row | Buy · Redeem · Update value row; Income in `⋯`. **✅ M5 (Buy · Redeem · Value + ⋯ Income)** |
| HLD-02 | Med | Four stat cards before the chart; Transactions / Valuations / Income / Details tabs 28px. | §5 segmented tabs | Header numbers block + segmented control. **🟡 M5: 44px tabs, stacked valuations; stat cards kept full width** |

### Update values — `/assets/update-values` (M5)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| UPD-01 | **High** | 6-column table makes the page 333px wider than the screen at 375 (348 at 360); "Save all" sits off-screen to the right; whole page pans sideways. | §2 no sideways scroll | One card per holding (last value, last updated, large input). **✅ M5 (one card per holding)** |
| UPD-02 | Med | "Save all" is at the top, not in the thumb zone. | §5 sticky Save all | Sticky "Save all (n changed)". **✅ M5 (pinned Save all, lifted above keyboard)** |

### `/assets/import-valuations` (M5)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| VIM-01 | Low | Upload step fine; preview/mapping steps use raw tables (`valuation-import-client.tsx`, X-06). | §2 | Mobile wizard steps. **✅ M5 (preview stacks)** |

### SIP — `/sip`, plans, execute, history (M6)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| SIP-01 | Low | Planner card is readable; Execute / Skip / History buttons 32px. | §2 | 44px action row. **✅ M6** |
| SIP-02 | Med | Execute: Confirm + status preview only at the very end (3 screens down); amounts unformatted (`21000.00`); planned vs actual per asset fine; "Units and price" `<summary>` 16px tall. | §5 SIP execute | Stepper by class, sticky footer with total/status/Confirm, mobile MoneyInput, 44px disclosure. **✅ M6 (pinned status + Confirm, 44px toggles)** |
| SIP-03 | Med | Plan editor: Save changes / Pause / End plan at the end; Start/End and Increase/Every side by side (OK at 375 but tight); allocation tree editor long. | §2, §5 | Sticky save bar; mobile allocation tree (class cards → asset rows, sticky 100% totals). **✅ M6 (pinned Pause/End/Save, sticky Total, 44px slider)** |
| SIP-04 | Med | History: ~4 screens of rows each with status badge on its own line and an "Undo" button; filters are two selects. | §3 | Compact card rows, filter sheet, Undo in action sheet. **✅ M6 (44px tabs; rows kept)** |

### Allocation / Rebalancing — `/rebalancing` (M6)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| RB-01 | Med | Plan / Planned vs Actual / Rebalance / History tabs wrap to 2 rows. | X-09 | Segmented chips. **✅ M6 (one scrolling row)** |
| RB-02 | Med | Target editor: sliders 16px tall, percent inputs + trash icons 32px, "Save target" at the end. | §2 | Mobile allocation tree editor (shared with SIP-03), sticky totals + save. **✅ M6 (sticky Total, pinned Save target)** |
| RB-03 | Low | Drift view: class buttons 20px tall. | §5 Rebalancing | Drift bars per class, tap to expand. **✅ M6 (table stacks)** |

### Opportunity Fund — `/opportunity-fund` (M6)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| OPP-01 | **High** | Deployment history table is clipped inside its card: Date · From · Drop · Into fit, Amount and the actions column are cut off. | §2, X-06 | Card list. **✅ M6** |
| OPP-02 | Med | Four stat cards first; no banner/gauge; "Record deployment" is a small button inside the Market levels card; rules editor with 32px inputs; "Save fund settings" at the end. | §5 Opportunity Fund | Banner + drawdown gauge, rule ladder list, deployment sheet, sticky save. **🟡 M6: history/split stack, full-width Save; gauge deferred (owner); stat cards full width** |
| OPP-03 | Med (bug, not mobile) | Console error: "Only plain objects can be passed to Client Components from Server Components. Objects with toJSON methods are not supported." on every load. | – | Serialise the offending prop (likely an ObjectId/Date-like value) in the page/queries. **Outside mobile scope — owner to decide when.** |

### Debts — `/debts`, `/debts/[id]` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| DEBT-01 | **High** | Loans table squeezes: "Toyota Aqua lease · Leasing · LB Finance" wraps to 6 lines, Rate column cut at the edge; Next due, Payoff and Repaid are hidden. | X-06 | Loan cards with progress. |
| DEBT-02 | Med | Three stat cards before the list. | X-11 | Compact strip. |
| DEBT-03 | **High** | Detail: amortisation schedule is a 60-row table showing only # / Date / Payment / Interest — Principal and Balance columns clipped; ~4 screens long. | §5 Debts | Schedule grouped by year (collapsible), card rows. |
| DEBT-04 | Med | Detail: five stat cards; Record payment / Prepayment / Edit loan buttons 32px at the top. | §2 | Header numbers block, sticky Record payment. |

### Recurring — `/recurring` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| REC-01 | **High** | Raw table: each row ~140px tall, Account column clipped mid-word ("Commerci"); Frequency, Next due, Status and the actions column are off the right edge (reachable only via an unhinted inner scroll). | X-06 | Card list with confirm sheet. |

### Budgets — `/budgets` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| BUD-01 | Low | Layout works; month arrows, Edit and trash are 32px; budgets list fine. | §2 | 44px controls; Edit/Delete in action sheet. |

### Goals — `/goals` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| GOAL-01 | Low | Goal cards read well; Edit / Archive and "Linked items" disclosure are small. | §2 | 44px actions. |

### Essentials — `/essentials` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| ESS-01 | **High** | Insurance policies table (`essentials-client.tsx` ~L752) widens the page: +300px at 375, and **+75px at 1440 (desktop bug)**. The `overflow-x-auto` wrapper sits in a grid cell that still grows to the table's min width, so the whole page pans sideways and the policies table is clipped ("Prem…"). | §2 | `min-w-0` on the grid cell (fixes desktop too) + card list on mobile. **Changes desktop rendering — owner to confirm.** |
| ESS-02 | Low | Health score gauge and component list fine; "What counts" two-column boxes tight. | §5 | Stack. |

### Forecast — `/forecast` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| FC-01 | **High** | Account balances table clipped: the third (projected) column is cut ("LKR 2,69…"). | X-06 | Card list. |
| FC-02 | Low | Cash forecast + projection charts stack correctly; axis labels wide (X-10). | §5 | Compact axes. |

### Reports — `/reports` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| RPT-01 | Med | Seven report tabs wrap to 4 rows. | X-09 | Scrollable segmented chips or a report picker sheet. |
| RPT-02 | **High** | Category and income tables clip their last column (Share %, previous-month); investing "by holding" table squeezes names. | X-06 | Lists. |
| RPT-03 | Low | Export CSV is an inline button; donuts fine. | §5 export via share | Share sheet on mobile. |

### Notifications — `/notifications` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| NOT-01 | Med | Mark-read ✓ and snooze 🕒 are unlabeled 32px icon buttons per row. | §2, §9 labels | Swipe actions + action sheet; labelled 44px buttons. |

### Settings — `/settings` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| SET-01 | Med | Section tabs scroll sideways with the active "Preferences" tab cut off on load; one long form; "Save preferences" at the end. | §5 Settings | Grouped list rows that push to sub-pages; sticky save per sub-page. |

### Onboarding — `/onboarding` (M7)
| ID | Sev | What's wrong | Rule | Proposed fix |
|---|---|---|---|---|
| ONB-01 | Low | Native timezone `<select>` is 14px (iOS will zoom on focus); step pills wrap to 2 rows. | §4 ≥16px | 16px select (or picker sheet); scrollable step indicator. |

## 4. Plan mapping and proposed plan changes

Every issue above is mapped to an existing phase. Changes I recommended to `docs/08-MOBILE-BUILD-PLAN.md`
(items 1–3 approved by the owner on 2026-10-29 and done in M2; the rest still open):

1. **M2 — responsive sizes on existing primitives (X-03).** The plan only lists new primitives;
   most small-tap findings come from `Button`, `Input`, `Select`, `Switch`, `Tabs` and topbar icon
   buttons. Add: "below `md`, primitives use ≥ 44px heights and 16px text; ≥ `md` unchanged".
2. **M2 — chart mobile mode (X-10)** in `src/components/charts/chart-kit.tsx` and a **mobile stat
   strip (X-11)**, so page phases reuse them instead of each page inventing its own.
3. **M2 — move `DataTable`'s card breakpoint from `sm` to `md` (X-06)** to match docs/07.
4. **M4 — capture the Money Manager wizard (IMP-02):** extend `npm run screens` to upload the e2e
   fixture (`tests/helpers/money-manager-fixture.ts`) so the wizard is audited.
5. **ESS-01 changes desktop** (removes a 75px horizontal scroll at 1440). The rule says desktop must
   not change; I recommend treating this as a bug fix in M7. Owner to confirm.
6. **Non-mobile bugs found by the console check:** OPP-03 (server→client serialisation error) and
   X-17 (Base UI `nativeButton` warning). Recommend fixing OPP-03 as a separate small fix outside the
   mobile phases, and X-17 alongside the M1 top-bar rework.
7. **Quick add "Debt pay" chip (QA-03)** adds a new entry point to an existing debt-payment action.
   It is UI only, but confirm it belongs in M3.
