---
name: new-module
description: Scaffold or extend a WealthTrack feature module (model, Zod schemas, service, server actions, queries, components, page) following the project's layering. Use when creating a new module under src/modules or adding a new entity.
argument-hint: "[module-name]"
---

# Create a feature module: `src/modules/<name>/`

Follow `docs/02-ARCHITECTURE.md` §2–4. Fields come from `docs/03-DATA-MODEL.md` — do not invent fields;
if one is missing, ask or log it under Decisions in `docs/PROGRESS.md`.

## Files
1. **`model.ts`** — Mongoose schema: `userId` required + indexed, timestamps, indexes from docs/03,
   integer validators for `*Minor` / `*Bp`, enums as `as const` arrays exported for reuse.
   Export `type <Entity>Doc` and the model (guard against re-compilation in dev).
2. **`schemas.ts`** — Zod input schemas (`create<Entity>Schema`, `update<Entity>Schema`, discriminated
   unions for typed variants) and DTO types. Money inputs arrive as minor-unit integers.
3. **`service.ts`** — `export async function verbEntity(ctx: Ctx, input: Input): Promise<DTO>`.
   Scopes by `ctx.userId`, uses `withTransaction` for multi-doc writes, calls domain functions for
   math, calls the ledger engine for any transaction posting, throws `AppError`. Returns plain DTOs.
4. **`actions.ts`** — `"use server"`; `requireUser()` → `safeParse` → service → `revalidatePath` →
   `ActionResult`. No business logic here.
5. **`queries.ts`** — server-only read functions used by Server Components (`import "server-only"`),
   `lean()` reads, projections, pagination.
6. **`components/`** — forms (React Hook Form + zodResolver), tables, cards. Client components only
   where interactivity is needed.
7. **Page** — `src/app/(app)/<route>/page.tsx`: fetch via queries, render components. Add `loading.tsx`
   and use `error.tsx` boundaries.
8. **Tests** — `tests/integration/<name>.test.ts` for each service write path; domain tests in
   `tests/unit/domain/`.

## Done when
- [ ] Every query filtered by `userId`; no `any`.
- [ ] Indexes match docs/03.
- [ ] Empty, loading and error states present.
- [ ] `npm run verify` passes.
