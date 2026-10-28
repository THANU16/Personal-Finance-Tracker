# Mobile UX kit — how to use

Copy these files into your existing project folder (merge with what's there):
```
docs/07-MOBILE-UX.md          ← mobile design rules and screen layouts
docs/08-MOBILE-BUILD-PLAN.md  ← phases M0–M8 with prompts
docs/MOBILE-PROGRESS.md       ← Claude updates this
.claude/skills/mobile-phase/  ← /mobile-phase <n>
.claude/skills/mobile-ux/     ← mobile rules, auto-loaded when editing UI
```

## One-time setup
1. Add to `CLAUDE.md` under "Source of truth":
   `- docs/07-MOBILE-UX.md and docs/08-MOBILE-BUILD-PLAN.md — mobile layout rules and plan`
2. Add to `.env.local` (local demo user only, never your real login):
   ```
   E2E_EMAIL=demo@wealthtrack.local
   E2E_PASSWORD=Demo12345!
   ```
3. Add `screens/` to `.gitignore`.
4. Run `npm run seed` so every page has realistic demo data.

## Build
```
claude
/mobile-phase M0
```
M0 only audits: Claude screenshots every page at iPhone sizes and writes `docs/MOBILE-AUDIT.md`.
Read the audit, tell Claude what to change, then `/clear` and continue with
`/mobile-phase M1`, `M2` … `M8`.

After each phase: `git push` (Vercel redeploys), open the app from your iPhone home-screen icon
and try the screens that changed.
