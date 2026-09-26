# ACTGDS Driver

Mobile-first instructor app (PWA) for **ACT Golden Driving School**.

GitHub repo: `tony-kunliu/instructor-assistant`

The first MVP does one thing: let an instructor complete the **ACT CBT&A
Lesson Checklist** on an iPhone right after each driving lesson.

## Stack

- Next.js (App Router) + React + TypeScript
- SQLite via Node's built-in `node:sqlite` (no ORM, no extra DB dependency).
  The schema is plain SQL (`lib/schema.ts`) so it can move to Cloudflare D1
  (the main ACTGDS site's database) without changes.
- Installable PWA (web manifest, iOS home-screen meta)

## Requirements

- Node.js ≥ 22.13

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm test
```

The database file is created automatically at `data/actgds-driver.sqlite`
(override with `ACTGDS_DRIVER_DB=/path/to/file.sqlite`). It is git-ignored.

## Branches

`feature/*` → `staging` → `main` → Production (separate approval required).
See `AGENTS.md` for working rules.
