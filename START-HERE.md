# WealthTrack — Claude Code build kit

This folder is the starting point of your project. Claude Code reads `CLAUDE.md` automatically,
loads the skills in `.claude/skills/`, and follows the specs in `docs/`.

## What's inside
```
wealthtrack/
├── START-HERE.md            ← this file (you can delete it later)
├── CLAUDE.md                ← project rules Claude reads every session
├── docker-compose.yml       ← optional local MongoDB replica set (Atlas is the default)
├── .env.example             ← copy to .env.local
├── docs/
│   ├── 01-PRD.md            ← every feature in Version 1
│   ├── 02-ARCHITECTURE.md   ← stack, folder structure, layering, security
│   ├── 03-DATA-MODEL.md     ← MongoDB collections and indexes
│   ├── 04-BUSINESS-RULES.md ← all calculations (redemption, XIRR, SIP, drift, loans, FD…)
│   ├── 05-UI-SPEC.md        ← every screen
│   ├── 06-BUILD-PLAN.md     ← 13 phases with ready prompts and acceptance checks
│   └── PROGRESS.md          ← Claude updates this after each phase
└── .claude/skills/
    ├── build-phase/         ← /build-phase <n> runs a whole phase
    ├── finance-domain/      ← money rules, auto-loaded when editing finance code
    ├── new-module/          ← how to scaffold a feature module
    ├── ui-conventions/      ← UI rules, auto-loaded when editing pages/components
    ├── testing/             ← test conventions
    └── verify/              ← quality gate before each commit
```

## Setup (once)
1. Install Node.js LTS, Git and Claude Code, and create a free MongoDB Atlas cluster
   (Atlas clusters are replica sets, which the ledger's transactions need).
2. Unzip this kit into an empty folder, e.g. `wealthtrack\`, then in PowerShell:
   ```powershell
   cd wealthtrack
   git init
   Copy-Item .env.example .env.local   # then set MONGODB_URI (Atlas), BETTER_AUTH_SECRET, CRON_SECRET
   npm install
   npm run db:check                    # confirms Atlas is reachable and supports transactions
   claude
   ```
   Prefer a local database? `docker compose up -d` starts a single-node replica set on
   localhost:27017 (optional; needs Docker Desktop) — use the localhost URI from `.env.example`.
3. Read the docs once yourself (especially `01-PRD.md` and `04-BUSINESS-RULES.md`). Change anything
   you disagree with **before** building — the docs are the contract.

## Build (one phase per session)
Run MOD-1 and MOD-2 (docs/06 → Post-phase modifications) before Phase 4.

In Claude Code type:
```
/build-phase 0
```
Claude plans, waits for your approval, builds, runs tests, updates `docs/PROGRESS.md` and commits.
Then `/clear` (or open a new session) and run `/build-phase 1`, and so on up to 12.

After each phase: open `http://localhost:3000` (`npm run dev`), click through what was built, and
tell Claude about anything wrong before moving on.

## Tips
- Prefer phase-by-phase over one giant prompt; quality stays much higher.
- If Claude asks a question about the docs, answer it and ask Claude to update the doc too.
- To change a rule later: edit the doc first, then ask Claude to update code and tests to match.
- `npm run seed -- <email>` loads 18 months of demo data. See `README.md` for setup, deploy and Docker.
