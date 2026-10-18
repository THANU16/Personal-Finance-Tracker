---
name: testing
description: How to write WealthTrack tests — Vitest unit tests for pure domain functions, integration tests against an in-memory MongoDB replica set, factories, and Playwright e2e. Use when adding or fixing tests.
paths:
  - "tests/**"
---

# Testing conventions

## Layout
- `tests/unit/domain/<file>.test.ts` — pure functions, no DB. Table-driven (`it.each`).
- `tests/integration/<module>.test.ts` — services against `mongodb-memory-server` **replica set**
  (`MongoMemoryReplSet`, needed for transactions). Helper `tests/helpers/test-db.ts`: start once per
  file, clear collections `beforeEach`, stop `afterAll`.
- `tests/helpers/factories.ts` — `makeUser()`, `makeAccount(ctx, overrides)`, `makeHolding(...)`,
  `post(ctx, txn)`. Factories call services, not models, so caches stay correct.
- `tests/e2e/*.spec.ts` — Playwright against `npm run dev` with a seeded test user.

## Rules
- Every domain function: happy path, edge cases (zero, rounding remainders, empty input, negative
  where invalid) and the worked example from `docs/04-BUSINESS-RULES.md`.
- Every service write path: success, validation error, other user's data is invisible (userId isolation),
  and atomicity (force a failure mid-transaction and assert nothing persisted).
- Ledger tests: post → assert caches → void → assert caches back to the original → `recompute` gives the same result.
- Money assertions use exact integers (`toBe`), never `toBeCloseTo`. XIRR uses `toBeCloseTo(x, 4)`.
- Freeze time with `vi.setSystemTime` for date logic; test the `Asia/Colombo` boundary
  (e.g. 2026-10-31T19:00Z is already 1 Nov local).
- Never delete or loosen a failing test to get green; fix the code or ask.
