# ACTGDS Driver

Mobile-first instructor app (PWA) for **ACT Golden Driving School**.

The first MVP does one thing: let an instructor complete the **ACT CBT&A
Lesson Checklist** on an iPhone right after each driving lesson.

## Stack

- Next.js (App Router) + React + TypeScript
- SQLite via Node's built-in `node:sqlite` (no ORM, no extra DB dependency).
  The schema is plain SQL (`db/schema.sql`) so it can move to Cloudflare D1
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

## What it does (MVP)

Select learner → **Start Lesson** → drive → **End Lesson** → finish odometer →
Taught / Competencies Assessed / Achieved / Location / Comments → ADI signature
→ learner signature → **Save**.

Derived automatically: lesson number, duration, lesson km, cumulative hours and
km. The previous lesson's finish odometer pre-fills the next start odometer.

## Data model

`lib/schema.ts` — three tables:

- `instructors` — ADI details.
- `learners` — CBT&A header fields, `instructor_id`, `licence_stage`
  (`learner` / `p1` / `p2` / `full`, reserved for a future Driving Journey).
- `lessons` — one row per CBT&A lesson, including computed and cumulative
  values and both signatures (PNG data URLs). `UNIQUE(learner_id, lesson_no)`.

Future bookings, CRM notes and learner/parent accounts can reference
`learners.id` / `lessons.id` without changing these tables.

## Code map

- `lib/calc.ts` — pure calculations (shared by UI and server)
- `lib/repo.ts` — database reads/writes and validation
- `app/api/**` — JSON API route handlers
- `app/driver-app.tsx` — the single-screen instructor UI
- `tests/` — `node --test` unit and workflow tests

## Branches

`feature/*` → `staging` → `main` → Production (separate approval required).
See `AGENTS.md` for working rules.
