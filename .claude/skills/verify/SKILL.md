---
name: verify
description: Run WealthTrack's quality gate (typecheck, lint, unit and integration tests) and fix any failures. Use before every commit and before declaring a task done.
---

1. Run `npm run verify` (tests use the in-memory MongoDB replica set, so Docker isn't needed).
2. If anything fails, fix the root cause (not the test), then run it again until it passes.
3. If the change touched UI, also start `npm run dev` and load the affected pages to confirm they
   render without console errors.
4. Report: ✅ typecheck · ✅ lint · ✅ tests (counts), or what still fails and why.
