# 02 — Architecture & Conventions

## 1. Stack decisions
| Concern | Choice | Why |
|---|---|---|
| App | Next.js (latest stable), App Router, TypeScript `strict` | One codebase for UI + backend |
| DB | MongoDB Atlas (dev and prod; optional Docker replica set locally) | Requested; transactions need a replica set |
| ODM | Mongoose + `lean()` reads | Schemas, indexes, middleware |
| Validation | Zod (shared client/server) | One schema per input |
| Auth | Better Auth, email/password, MongoDB adapter | Self-hosted, sessions in Mongo |
| UI | Tailwind CSS + shadcn/ui + lucide-react | Accessible primitives |
| Forms | React Hook Form + zodResolver | |
| Charts | Recharts | |
| Tables | TanStack Table | Sorting/filtering for ledger |
| Dates | date-fns + date-fns-tz | Timezone-aware periods |
| Email | Resend (optional, behind interface) | Reminder emails |
| Files | `StorageProvider` interface: local disk (dev), S3-compatible (prod) | Receipts |
| Tests | Vitest, mongodb-memory-server (replSet), Playwright | |
| Quality | ESLint, Prettier, Husky + lint-staged | |
| Scheduling | Route handler `/api/cron/daily` protected by `CRON_SECRET` (Vercel Cron or system cron) | |

## 2. Layering (dependencies point downward only)
```
app/ (pages, layouts, route handlers)      ← thin: auth, parse, call, render
  └─ modules/<m>/actions.ts, queries.ts    ← server actions / read functions, Zod-validated
       └─ modules/<m>/service.ts           ← business orchestration, transactions, userId scoping
            ├─ domain/*                    ← PURE functions (money math), no I/O
            └─ modules/<m>/model.ts        ← Mongoose models
server/ (db, auth, errors, ledger engine, cron jobs, storage, mail)
lib/ (formatting, utils shared with client — no server imports)
```
Rules:
- `domain/` imports nothing from `server/`, `modules/`, `next`, or `mongoose`.
- Client components never import `service.ts`/`model.ts`; they call server actions.
- Cross-module writes go through the other module's service, never its model.
- The **ledger engine** (`server/ledger/`) is the only code that creates/voids transactions and
  calls `recomputeAccount`/`recomputeHolding`.

## 3. Folder structure
```
wealthtrack/
├── CLAUDE.md
├── docs/                         # specs (this kit)
├── .claude/skills/               # Claude Code project skills
├── docker-compose.yml            # optional local mongo replica set (Atlas is the default)
├── .env.example
├── public/                       # icons, manifest.webmanifest
├── scripts/
│   ├── seed.ts                   # demo data
│   ├── db-check.ts               # verify MONGODB_URI: reachable, replica set, transactions
│   ├── e2e-server.ts             # Playwright server: in-memory replica set + next build/start :3100
│   └── recompute-all.ts          # rebuild caches from ledger
├── src/
│   ├── proxy.ts                  # auth redirect for (app) routes (Next 16 name for middleware)
│   ├── instrumentation.ts        # validates env at server start
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/register/page.tsx
│   │   ├── (app)/layout.tsx               # sidebar, topbar, quick-add, notifications
│   │   ├── (app)/dashboard/page.tsx
│   │   ├── (app)/accounts/page.tsx
│   │   ├── (app)/accounts/[id]/page.tsx
│   │   ├── (app)/transactions/page.tsx
│   │   ├── (app)/transactions/import/page.tsx
│   │   ├── (app)/assets/page.tsx
│   │   ├── (app)/assets/[id]/page.tsx
│   │   ├── (app)/assets/update-values/page.tsx
│   │   ├── (app)/sip/page.tsx                    # planner overview + upcoming
│   │   ├── (app)/sip/plans/new/page.tsx
│   │   ├── (app)/sip/plans/[id]/page.tsx
│   │   ├── (app)/sip/execute/[executionId]/page.tsx
│   │   ├── (app)/sip/history/page.tsx
│   │   ├── (app)/rebalancing/page.tsx
│   │   ├── (app)/opportunity-fund/page.tsx
│   │   ├── (app)/debts/page.tsx
│   │   ├── (app)/debts/[id]/page.tsx
│   │   ├── (app)/recurring/page.tsx
│   │   ├── (app)/budgets/page.tsx
│   │   ├── (app)/goals/page.tsx
│   │   ├── (app)/essentials/page.tsx
│   │   ├── (app)/forecast/page.tsx
│   │   ├── (app)/reports/page.tsx
│   │   ├── (app)/notifications/page.tsx
│   │   ├── (app)/settings/page.tsx               # tabs: profile, preferences, categories,
│   │   │                                         # asset classes, fx rates, data (backup)
│   │   ├── api/auth/[...all]/route.ts
│   │   ├── api/cron/daily/route.ts
│   │   ├── api/export/route.ts
│   │   ├── api/import/route.ts
│   │   ├── api/files/route.ts
│   │   ├── layout.tsx · globals.css · not-found.tsx · error.tsx
│   ├── domain/                   # pure, unit-tested
│   │   ├── money.ts              # add/sub/mulBp, allocate (largest remainder), convert
│   │   ├── allocation.ts         # two-level tree validation & split
│   │   ├── redemption.ts         # proportional cost, by-units
│   │   ├── returns.ts            # xirr, simple return, cagr
│   │   ├── drift.ts              # weights, drift, cashflow & full rebalance plans
│   │   ├── loan.ts               # emi, amortisation, prepayment
│   │   ├── fd.ts                 # fd value, payouts, maturity
│   │   ├── sip.ts                # due periods, step-up, carry-forward
│   │   ├── opportunity.ts        # drawdown, rule triggers, cycles
│   │   ├── recurrence.ts         # next due dates
│   │   ├── budget.ts · goal.ts · essentials.ts · forecast.ts
│   │   ├── ledger.ts             # posting effects, balances, running balance, cashflow, splits
│   │   ├── accounts.ts · dates.ts · date-range.ts  # card utilisation/due, business dates, presets
│   │   └── periods.ts            # period keys in user timezone
│   ├── modules/
│   │   ├── accounts/        { model, schemas, service, actions, queries, components/ }
│   │   ├── categories/
│   │   ├── asset-classes/
│   │   ├── transactions/
│   │   ├── holdings/        (incl. valuations)
│   │   ├── sip/
│   │   ├── rebalancing/
│   │   ├── opportunity-fund/
│   │   ├── debts/
│   │   ├── recurring/
│   │   ├── budgets/
│   │   ├── goals/
│   │   ├── essentials/      (insurance)
│   │   ├── snapshots/
│   │   ├── notifications/
│   │   ├── reports/
│   │   ├── forecast/
│   │   ├── imports/
│   │   ├── fx/
│   │   ├── attachments/
│   │   └── settings/
│   ├── server/
│   │   ├── db/connect.ts · db/transaction.ts (withTransaction) · db/model.ts (userScopedModel)
│   │   ├── db/user-id-guard.ts · db/ids.ts · ctx.ts (Ctx) · run-action.ts (runAction → ActionResult)
│   │   ├── bootstrap.ts (first-login seeding) · audit/model.ts (auditLog + writeAudit)
│   │   ├── auth/auth.ts · auth/require-user.ts
│   │   ├── ledger/post.ts · ledger/void.ts · ledger/recompute.ts (accounts + holdings)
│   │   ├── ledger/holding-events.ts (txns + valuations → replay events, FD value)
│   │   ├── cron/daily.ts (orchestrates jobs) · cron/jobs/*.ts
│   │   ├── errors.ts (AppError, codes) · action-result.ts
│   │   ├── storage/ (StorageProvider) · mail/ (Mailer)
│   │   └── env.ts (Zod-validated env)
│   ├── components/
│   │   ├── ui/              # shadcn generated
│   │   ├── layout/          # sidebar, topbar, page-header
│   │   └── shared/          # money-input, money, percent, date-picker, account-select,
│   │                        # holding-select, allocation-tree-editor, stat-card, empty-state,
│   │                        # data-table, confirm-dialog, stale-badge, trend-chip
│   ├── lib/                 # format.ts, utils.ts (cn), constants.ts — client-safe
│   └── types/
└── tests/
    ├── unit/domain/*.test.ts
    ├── integration/<module>.test.ts
    ├── e2e/*.spec.ts
    └── helpers/ (test-db.ts, factories.ts)
```

## 4. Patterns

### Action result
```ts
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } };
```
Actions: `requireUser()` → `schema.safeParse(input)` → `service.fn(ctx, data)` → `revalidatePath()` → result.

### Service signature
```ts
export async function executeSip(ctx: Ctx, input: ExecuteSipInput): Promise<SipExecutionDTO>
```
`Ctx = { userId: string; tz: string; baseCurrency: string }`. Services return plain DTOs (no Mongoose docs).

### Transactions
```ts
await withTransaction(async (session) => { ...all writes pass { session } ... });
```

### Money in the UI
`<MoneyInput>` accepts decimals and converts to minor units on submit; `<Money value currency />`
renders with thousands separators, negative in red, privacy-blur when "hide amounts" is on.

## 5. Security
- Better Auth sessions (httpOnly, secure, sameSite=lax). Login rate limit.
- `src/proxy.ts` redirects unauthenticated users; every service still checks `ctx.userId`.
- Mongoose plugin adds `userId` filter guard: queries without `userId` throw in dev/test.
- Env validated at boot (`server/env.ts`). Secrets never sent to client.
- Cron route requires `Authorization: Bearer ${CRON_SECRET}`.
- File uploads: type/size validation, stored by key, served via authenticated route.

## 6. Environments
`.env.local` (dev, Atlas cluster/database), Atlas + Vercel (prod) or Docker self-host. Dev machine
is Windows/PowerShell, so npm scripts stay shell-neutral. See `.env.example`.

## 7. Git
Trunk-based; one commit (or PR) per phase; conventional commits; `npm run verify` in pre-commit.
