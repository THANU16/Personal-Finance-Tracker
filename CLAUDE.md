# WealthTrack — Personal Finance & Portfolio Tracker

Manual-first app that tracks day-to-day money (income, expenses, transfers, cards, loans) and every
investment (buy, SIP, redeem, dividends, valuations) in ONE ledger, then derives net worth, cashflow,
returns, allocation, drift, goals and reminders from it. No bank/broker sync. Single user today,
multi-user-safe by design (every document carries `userId`).

## Source of truth (read the relevant doc before coding a feature)
- `docs/01-PRD.md` — features and scope
- `docs/02-ARCHITECTURE.md` — stack, folder structure, layering, conventions
- `docs/03-DATA-MODEL.md` — MongoDB collections, fields, indexes
- `docs/04-BUSINESS-RULES.md` — every calculation and posting rule (money math lives here)
- `docs/05-UI-SPEC.md` — screens, components, UX rules
- `docs/06-BUILD-PLAN.md` — phases, prompts, acceptance criteria
- `docs/PROGRESS.md` — what is done; update it at the end of every phase

If code and docs disagree, STOP and ask which is right. Never silently change a business rule.
If a doc is ambiguous, pick the simplest option consistent with the rules below and log it under
"Decisions" in `docs/PROGRESS.md`.

## Stack
Next.js (latest stable, App Router, TypeScript strict) for frontend AND backend · MongoDB via
Mongoose · Zod · Better Auth (email/password, MongoDB adapter) · Tailwind CSS + shadcn/ui ·
Recharts · React Hook Form · date-fns + date-fns-tz · Vitest (+ mongodb-memory-server replica set)
· Playwright. Check current docs for library APIs before using them; do not rely on memory for
version-specific APIs. Next.js 16 ships its docs in `node_modules/next/dist/docs/` (see `AGENTS.md`);
note `src/proxy.ts` replaces `middleware.ts`.

## Commands
Dev machine is Windows (PowerShell) with MongoDB Atlas: `MONGODB_URI` in `.env.local` points to an
Atlas cluster (always a replica set, so transactions work). Keep npm scripts shell-neutral (no `cp`,
`rm -rf`, `VAR=x cmd`); write helper scripts in TypeScript under `scripts/` and run them with `tsx`.
- `npm run db:check` — verify `MONGODB_URI` is reachable, a replica set, and supports transactions
- `npm run dev` — dev server
- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run test:e2e`
- `npm run seed` — demo user + realistic sample data
- `npm run verify` — typecheck + lint + unit/integration tests (must pass before every commit)

## Non-negotiable rules
1. **Money is integer minor units** (`amountMinor: number`, e.g. cents). Never floats for money.
   Format only in the UI via `formatMoney()`. **Percentages are basis points** (10000 = 100%).
2. **The ledger is the source of truth.** Account balances and holding totals are caches recomputed
   by `recomputeAccount()` / `recomputeHolding()` from transactions + valuations. Never `$inc` a
   cached total directly.
3. **Multi-document writes run in a MongoDB transaction** via `withTransaction()`. SIP execution,
   redeem, transfer, debt payment, deployment and voids must be atomic.
4. **Every query is scoped by `userId`.** Services receive `ctx: { userId }` from `requireUser()`.
   Never accept `userId` from the client.
5. **Pure domain logic lives in `src/domain/`** (no DB, no Next.js imports) and is unit tested:
   XIRR, redemption cost, allocation split, drift, EMI/amortisation, FD interest, step-up, forecast.
6. **Validate every boundary with Zod** (server actions, route handlers, CSV import). Recalculate
   totals on the server; never trust client-computed amounts.
7. **Allocation rounding uses the largest-remainder method** so split lines sum exactly to the total.
8. **Dates:** store UTC `Date`. Business dates (period, due date, month) are computed in the user's
   timezone (default `Asia/Colombo`). Period keys: `YYYY-MM` (monthly), `YYYY-Www` (weekly).
9. **Posted financial records are never hard-deleted.** Transactions are voided (`status: "void"`)
   and caches recomputed. Grouped operations (SIP execution, deployment) are voided via their owner.
10. Base currency LKR by default (user setting). Accounts and holdings may have their own currency;
    reports convert with the latest `fxRates` entry on or before the date.
11. **Earmarked money is protected.** Emergency/opportunity earmarks (docs/04 §20) must be honoured: outflows from earmarkable accounts go
    through the dip guard; never spend into earmarks without the confirm flags. Free cash is computed, never stored.
12. **Flows are summed, stocks are closing values** per bucket; bucket in the user timezone; gap-fill every series (docs/04 §22).
13. **One planned allocation.** SIP plans and opportunity deployments default to the target allocation; custom trees are the exception.

## Code conventions
- Feature modules in `src/modules/<module>/`: `model.ts`, `schemas.ts`, `service.ts`, `actions.ts`,
  `queries.ts`, `components/`. Pages in `src/app/(app)/<route>/page.tsx` stay thin.
- Server Components for reads; Server Actions for mutations returning `ActionResult<T>`;
  Route Handlers only for cron, export/import, file upload and auth.
- Services throw `AppError(code, message)`; actions map it to `{ ok: false, error }`.
- Files kebab-case, components PascalCase, Mongo collections plural camelCase.
- No `any`. No default exports except Next.js pages/layouts/route files.
- Every domain function and every service write path has tests (see the `testing` skill).

## Workflow
- Build one phase at a time with `/build-phase <n>`; plan first, then build, then `npm run verify`.
- Use the `finance-domain` skill whenever touching ledger, holdings, SIP, debts or any calculation.
- Use `new-module` when creating a feature module and `ui-conventions` for any UI work.
- Use `analytics-charts` for any chart, series or time-range work.
- Commit at the end of each phase: `feat(phase-<n>): <summary>`.
- Update `docs/PROGRESS.md` (done, decisions, deviations, open questions) at the end of each phase.
