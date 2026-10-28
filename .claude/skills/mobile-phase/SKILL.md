---
name: mobile-phase
description: Build one phase of the WealthTrack mobile UX plan (audit, plan, implement, screenshot-check, verify, log, commit). Use when the user types /mobile-phase with a phase number like M0 or 3.
argument-hint: "[phase, e.g. M0 or 3]"
disable-model-invocation: true
---

Build **mobile phase $ARGUMENTS** (treat "3" and "M3" as the same phase).

1. Read `CLAUDE.md`, `docs/07-MOBILE-UX.md`, `docs/MOBILE-PROGRESS.md`, `docs/MOBILE-AUDIT.md` (if it
   exists) and the matching phase in `docs/08-MOBILE-BUILD-PLAN.md`. If an earlier mobile phase is
   not ✅, stop and tell the user. Phases after M0 need `docs/MOBILE-AUDIT.md`.
2. Load the `mobile-ux` and `ui-conventions` skills. Load `finance-domain` only if a change touches
   calculations (it should not — mobile work is layout only).
3. **Plan first:** list the audit issues this phase fixes, files to change, new components, and
   before/after behaviour per page. Wait for approval.
4. Implement. Rules: layout/component changes only; no changes to services, models, domain or
   business rules; desktop (≥ md) must render exactly as before.
5. Run `npm run screens` and inspect the screenshots for every page touched at 375px, 393px and
   1440px. Fix overflow, small tap targets, small inputs, and anything that breaks docs/07.
6. Run `npm run verify`; fix failures at the root cause.
7. Report each acceptance item as pass/fail with evidence (screenshot paths).
8. Update `docs/MOBILE-PROGRESS.md` and mark fixed issues in `docs/MOBILE-AUDIT.md`.
9. Commit `feat(mobile-$ARGUMENTS): <summary>`.
10. Tell the user what to try on their iPhone (after deploying) and anything they must decide.
