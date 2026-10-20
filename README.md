# WealthTrack

A manual-first personal finance and portfolio tracker. Day-to-day money (income, expenses, transfers,
cards, loans) and every investment (buys, SIPs, redemptions, dividends, values) live in **one ledger**;
net worth, cashflow, returns (XIRR), allocation and drift, goals, budgets, an emergency fund, a cash
forecast and reminders are all derived from it. No bank or broker sync. Multi-user safe (every record
carries its owner); built for one person or a household.

Stack: Next.js 16 (App Router, Server Components, Server Actions) · MongoDB (Mongoose, transactions) ·
Better Auth · Zod · Tailwind + shadcn/ui · Recharts · Vitest · Playwright.

- [Run it locally](#run-it-locally)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Deploy: Vercel + MongoDB Atlas](#deploy-vercel--mongodb-atlas)
- [Self-host with Docker](#self-host-with-docker)
- [Data: backup, restore, imports](#data-backup-restore-imports)
- [Troubleshooting](#troubleshooting)
- [Project docs](#project-docs)

## Run it locally

You need **Node.js 24 LTS** (20.9+ works), **Git**, and a **MongoDB replica set** — transactions need
one. Either a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (always a replica set) or
Docker for a local one.

```bash
git clone <your-repo-url> wealthtrack
cd wealthtrack
npm install
cp .env.example .env.local          # PowerShell: Copy-Item .env.example .env.local
```

Edit `.env.local` — at minimum:

| Variable | Value |
|---|---|
| `MONGODB_URI` | Atlas: the `mongodb+srv://…/wealthtrack` connection string. Local Docker: `mongodb://localhost:27017/wealthtrack?replicaSet=rs0&directConnection=true` (start it with `docker compose up -d`). |
| `BETTER_AUTH_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | 16+ random characters (same command works). |

Then:

```bash
npm run db:check        # reachable, a replica set, and transactions work
npm run dev             # http://localhost:3000
```

Register an account. A short onboarding asks for your currency and timezone, then accounts and holdings
(every step can be skipped). In development the first step also offers **Load demo data**: 18 months of
realistic LKR data across every feature.

To load the demo data into an existing (empty) account from the command line:

```bash
npm run seed -- you@example.com
```

## Environment variables

All variables are validated when the server starts (`src/server/env.ts`); a missing or bad value stops
the app with the variable's name. `.env.example` lists them with comments.

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Must be a replica set (Atlas always is). |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 chars. Also encrypts two-factor secrets — changing it breaks existing 2FA enrolments. |
| `BETTER_AUTH_URL` | yes | The site's origin, **without a path**: `https://wealth.example.com`, not `…/login`. |
| `APP_URL` | yes | Public URL used in emails (usually the same as `BETTER_AUTH_URL`). |
| `CRON_SECRET` | yes | ≥ 16 chars. The daily job is called with `Authorization: Bearer <CRON_SECRET>`. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | no | Extra origins allowed to sign in (comma-separated). Vercel deployment URLs are trusted automatically. |
| `DISABLE_SIGNUP` | no | `true` closes registration (set it after creating your account). |
| `REQUIRE_EMAIL_VERIFICATION` | no | `true` needs working email. |
| `AUTH_RATE_LIMIT` | no | `on` (default). Only the e2e test server turns it off. |
| `DEFAULT_TIMEZONE`, `DEFAULT_CURRENCY` | no | Defaults for new users (`Asia/Colombo`, `LKR`). |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Email via [Resend](https://resend.com): password reset, verification, reminder digests. Empty = no email (development prints links to the terminal). |
| `STORAGE_DRIVER` | no | `local` (default) or `s3` — where receipts/attachments are stored. |
| `STORAGE_LOCAL_DIR` | no | Local folder for attachments (default `./.uploads`). Not suitable for Vercel (no persistent disk). |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | with `s3` | Any S3-compatible store: AWS (leave the endpoint empty), Cloudflare R2, Backblaze B2, MinIO (set the endpoint; R2 region `auto`). |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server. |
| `npm run build` / `npm start` | Production build / server. |
| `npm run verify` | Typecheck + lint + unit and integration tests (in-memory MongoDB). Run before every commit. |
| `npm run test:e2e` | Playwright end-to-end tests against a production build on a throwaway database. |
| `npm run db:check` | Checks `MONGODB_URI` (reachable, replica set, transactions). |
| `npm run seed -- <email>` | 18 months of demo data for one empty account (`--append` to add anyway). |
| `npm run recompute` | Rebuilds every balance and holding cache from the ledger (safe; changes nothing when correct). |
| `npm run reset-password -- <email> <newPassword>` | Offline password reset when email is not configured. |
| `npm run delete-users -- <userId> … [--confirm]` | Permanently deletes users and all their data (dry run without `--confirm`). |

Scripts read `.env.local`, so they act on whatever database `MONGODB_URI` points to.

## Deploy: Vercel + MongoDB Atlas

1. **Atlas**: create a cluster and a database user; under *Network Access* allow Vercel (simplest:
   `0.0.0.0/0` with a strong password). Copy the `mongodb+srv` connection string with `/wealthtrack`
   as the database name.
2. **Vercel**: import the Git repository (framework: Next.js; build command and output are detected).
3. Set the environment variables (Project → Settings → Environment Variables) for *Production*:
   `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `APP_URL` (your production URL, e.g.
   `https://wealthtrack.vercel.app` — **no path**), `CRON_SECRET`, and optionally email/S3 variables.
   Use `STORAGE_DRIVER=s3` on Vercel if you want attachments (the filesystem is not persistent).
4. Deploy. `vercel.json` schedules the daily job (`/api/cron/daily`, 00:30 UTC = 06:00 Colombo); Vercel
   sends the `CRON_SECRET` automatically. The Hobby plan allows one run a day, which is all it needs.
5. Register, then set `DISABLE_SIGNUP=true` and redeploy if the app is just for you.
6. After deploying a version that changed calculations, run `npm run recompute` once from your machine
   with `MONGODB_URI` pointing at Atlas.

## Self-host with Docker

The image is a Next.js standalone server (`output: "standalone"`) running as a non-root user.
`docker-compose.yml` has three services: `mongo` (single-node replica set), `app` and `cron` (calls the
daily job at 00:30 UTC).

```bash
cp .env.example .env.docker
# edit .env.docker: BETTER_AUTH_SECRET, CRON_SECRET, and BETTER_AUTH_URL / APP_URL = the URL users open
# (MONGODB_URI is set by docker-compose.yml)
docker compose --profile app up -d --build
```

Open `http://localhost:3000` (put a reverse proxy with HTTPS in front for anything beyond your machine).
Data lives in the `mongo-data` volume and attachments in `uploads` — back both up, or use the in-app
JSON backup. `docker compose up -d` without the profile starts only MongoDB (for local development).

The command-line scripts (seed, recompute, reset-password) are not inside the image: run them from a
checkout with `MONGODB_URI=mongodb://localhost:27017/wealthtrack?replicaSet=rs0&directConnection=true`.

## Data: backup, restore, imports

- **Backup**: Settings → Data → *Download backup* — one JSON file with everything (attachment files
  excluded). **Restore** works only into an empty account (e.g. a fresh registration) and re-creates
  every record with new ids, then recomputes all balances.
- **Exports**: every report tab and the Transactions list export CSV (UTF-8, opens in Excel).
- **Imports** (Transactions → Import): bank statement CSV (column mapping, category rules, duplicate
  detection), Money Manager (.xlsx) exports, and holding value history CSVs. Every import can be undone.

## Troubleshooting

- **`npm run db:check` says "not a replica set"** — use Atlas, or the Docker MongoDB (it initialises a
  replica set); a plain `mongod` does not support transactions.
- **"Invalid origin" or 404 on `/api/auth/…` after deploying** — `BETTER_AUTH_URL` must be the bare origin
  (no `/login`), and the site must be opened on that origin or a trusted one.
- **Windows: "Turbopack is not supported on this platform … native bindings"** — Windows Smart App
  Control / Application Control blocked `@next/swc-win32-x64-msvc`. Allow it (or reinstall
  `node_modules`); a `next build --webpack` fallback builds, but e2e dialogs misbehave in it.
- **Balances look wrong after an upgrade** — `npm run recompute`.
- **Forgot the password and no email configured** — `npm run reset-password -- <email> <newPassword>`.

## Project docs

`docs/01-PRD.md` (features) · `docs/02-ARCHITECTURE.md` · `docs/03-DATA-MODEL.md` ·
`docs/04-BUSINESS-RULES.md` (every calculation) · `docs/05-UI-SPEC.md` · `docs/06-BUILD-PLAN.md` ·
`docs/PROGRESS.md` (what was built, decisions, known issues). Money is stored as integer minor units and
percentages as basis points; the ledger is the source of truth and every cached total can be rebuilt.
