---
name: build-phase
description: Build one phase of the WealthTrack build plan end to end (plan, implement, test, verify, log, commit). Use when the user types /build-phase with a phase number.
argument-hint: "[phase-number]"
disable-model-invocation: true
---

Build **Phase $ARGUMENTS** of WealthTrack.

1. Read `CLAUDE.md`, `docs/PROGRESS.md`, and the "Phase $ARGUMENTS" section of `docs/06-BUILD-PLAN.md`.
   If an earlier phase is not ✅ in PROGRESS.md, stop and tell the user.
2. Read every doc section the phase prompt references (docs/03, docs/04, docs/05 sections).
3. Load the `finance-domain` skill if the phase touches money, ledger, holdings, SIP, debts or
   calculations; `new-module` for each new module; `ui-conventions` for pages/components;
   `testing` for tests.
4. **Plan first.** Present: files to create/change, models and indexes, domain functions with test
   cases, pages/components, and any doc ambiguity as questions. Wait for approval.
5. Implement in this order: domain functions + unit tests → models → services + integration tests →
   actions/queries → components → pages. Keep pages thin.
6. Run `npm run verify` after each major step; fix failures before continuing. Never weaken a test
   to make it pass; if a test contradicts the docs, ask.
7. Check the phase's **Acceptance** list item by item and report each as pass/fail with evidence.
8. Update `docs/PROGRESS.md`: mark the phase ✅ with date, add Decisions / Deviations / Open
   questions / Known issues.
9. Commit: `feat(phase-$ARGUMENTS): <short summary>`.
10. Finish with a short summary: what was built, how to try it in the browser, anything the user must decide.
