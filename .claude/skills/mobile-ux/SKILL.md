---
name: mobile-ux
description: WealthTrack mobile UI rules for screens below 768px — bottom tab bar, bottom sheets, card lists instead of tables, 44px tap targets, 16px inputs, safe areas, sticky action bars. Use whenever building or changing a page or component that must work on a phone.
paths:
  - "src/app/**/*.tsx"
  - "src/components/**"
  - "src/modules/**/components/**"
---

# Mobile UX rules (full spec: docs/07-MOBILE-UX.md)

Check every page/component change against this list at 375px width:

- [ ] No horizontal page scroll (only segmented chips may scroll sideways).
- [ ] Tables render as `CardList` rows below `md`; dialogs as bottom sheets (`ResponsiveDialog`).
- [ ] Tap targets ≥ 44×44px; inputs ≥ 16px font; money inputs `inputmode="decimal"`.
- [ ] Primary action in a `StickyActionBar` at the bottom, above the safe-area inset.
- [ ] Safe areas respected (top bar, tab bar, sheets).
- [ ] No hover-only information; tooltips become tap popovers.
- [ ] Skeleton, empty and error states present and sized like the real content.
- [ ] Charts full width, fixed height, simplified axes, lazy-loaded.
- [ ] Desktop (≥ md) unchanged — use responsive variants, not replacements.
- [ ] Business logic untouched: mobile work changes layout and components only.

Use Tailwind mobile-first: base classes = mobile, `md:` = desktop. Prefer one component with
responsive classes; use the shared responsive primitives (ResponsiveDialog, CardList,
ResponsiveSelect, FilterSheet, StickyActionBar, SegmentedControl) instead of `useIsMobile`
branches. Use `useIsMobile` only when the component tree truly differs.
