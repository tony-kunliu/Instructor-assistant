# ACTGDS Driver

Mobile-first instructor app (PWA) for **ACT Golden Driving School**.

GitHub repo: `tony-kunliu/instructor-assistant`

The first MVP does one thing: let an instructor complete the **ACT CBT&A
Lesson Checklist** on an iPhone right after each driving lesson.

## Stack

- Next.js (App Router) + React + TypeScript
- **Storage: D1-compatible.** `lib/repo.ts` only talks to the `D1Database`
  interface (`lib/d1-types.ts`) — the same shape as a real Cloudflare D1
  binding. Schema/migration: `migrations/0001_init.sql` (plain SQL, applied
  with `wrangler d1 migrations apply DB`). Locally (dev/test) it runs against
  `lib/d1-sqlite.ts`, a local D1-compatible adapter backed by `node:sqlite` —
  no code change needed to run against real D1 in a Cloudflare Worker, only
  swapping the binding in `lib/db.ts#getD1()`.
- Installable PWA (web manifest, iOS home-screen meta)

## Requirements

- Node.js ≥ 22.13

## Getting started

```bash
npm install
npm run db:migrate:local   # apply schema to the local D1 emulator (Miniflare, offline)
npm run dev                # http://localhost:3000
npm run build
npm test
```

The local database file is created automatically at
`data/actgds-driver.sqlite` (override with
`ACTGDS_DRIVER_DB=/path/to/file.sqlite`). It is git-ignored. Deploying with a
real Cloudflare D1 database requires Cloudflare account credentials — see
`wrangler.toml` and `STATUS.md`.

## Branches

`feature/*` → `staging` → `main` → Production (separate approval required).
See `AGENTS.md` for working rules.
