# Instructor Assistant

## Purpose

Instructor / Teaching **source of truth** for ACT Golden Driving School
(ACTGDS). An instructor completes each lesson's CBT&A checklist on their
phone right after a driving lesson. Core domain:

- Learners and lessons (duration, distance, odometer, signatures)
- CBT&A competencies 1-22, Review 1-17, Review 1-22, Final Drive 23
- History Edit (editing an earlier lesson, with downstream recalculation)
- CBT&A Checklist PDF export
- Integration Sender — emits `lesson.upserted` events to the separate
  ACTGDS Website repo (`tony-kunliu/actgds.com`), disabled by default

This repo never manages customer identity (name/phone/email/CRM) — that is
the ACTGDS Website's job. See `AGENTS.md` §10 for the full ecosystem
boundary.

## Architecture

- Next.js (App Router) + React + TypeScript
- Deployed as a Cloudflare Worker via `@opennextjs/cloudflare`
- Storage: Cloudflare D1 (SQLite-compatible) in production; a local
  `node:sqlite`-backed adapter for dev/test (`lib/db.ts`, `lib/d1-sqlite.ts`)
  — same `D1Database` interface both ways, no code branching
- Cloudflare Access protects both Staging and Production

## Local Development

```bash
npm install
npm run db:migrate:local   # apply schema to the local D1 emulator
npm run dev                # http://localhost:3000
```

Requires Node.js ≥ 22.13. The local database file is created automatically
at `data/actgds-driver.sqlite` (override with `ACTGDS_DRIVER_DB`); it is
git-ignored.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

All three run in GitHub Actions CI (`.github/workflows/ci.yml`) on every
push/PR to `main` and `staging`.

## Branch Flow

```
feature/* → staging → main → Production
```

- `staging` — integration and QA.
- `main` — trusted baseline; merging requires Tony's explicit authorization.
- Production — requires a **separate** explicit authorization from Tony,
  independent of any `main` merge.

See `AGENTS.md` for the full working rules every agent in this repo follows.

## Documentation

- `AGENTS.md` — permanent working rules (read this first)
- `STATUS.md` — current state: branches, environments, Integration status
- `TASK.md` — current task and next recommended step
- `docs/INDEX.md` — everything else (ecosystem roadmap, Integration contract)

## Data attribution

The learner Address suggestions use a bundled street index
(`public/data/streets-<release>.json`, built by `scripts/build-street-index.mjs`)
that incorporates or was developed using G-NAF © Geoscape Australia, licensed by
the Commonwealth of Australia under the Open Geo-coded National Address File
(G-NAF) End User Licence Agreement (CC BY 4.0 plus the mail-out use
restriction, which does not apply: this app sends no mail). Source:
data.gov.au, "Geocoded National Address File (G-NAF)". The attribution is also
shown in the app footer and in the data file's header.

Lesson GPS uses a local ACT junction index from the Geofabrik ACT extract
(2026-11-01), © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
licensed under ODbL 1.0. The adapted index is provided at
`public/openstreetmap/act-junctions-2026-11-01.json`. Regenerate it with
`python scripts/build-act-junctions.py ACT_EXTRACT.osm.pbf YYYY-MM-DD` (requires osmium)
and update the recap import to the new dated filename.

## Production Safety

Production deploy always requires Tony's explicit, separate authorization —
merging into `main` does not imply permission to deploy to Production.
