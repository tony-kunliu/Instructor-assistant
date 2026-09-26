# STATUS.md

_Last updated: 2026-09-26_

Repo: `tony-kunliu/instructor-assistant`

| Branch | Commit | State |
| --- | --- | --- |
| `main` | `98aa0c047d9b99d309c531cddb81555f8444ab43` | Working rules / docs baseline only. CBT&A MVP, D1 storage and Cloudflare deployment not yet merged in. Not deployed. |
| `staging` | (pending merge of `claude/cloudflare-d1-staging-vgxscm`) | CBT&A Lesson Checklist MVP + D1-compatible storage + live Cloudflare Staging deployment. |
| `feature/cbta-checklist` | `e7e2c3d93902d286e2bcd03e8ac08541cd6f7186` | CBT&A Lesson Checklist MVP — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/d1-storage` | `87b40be6258924329ae85f888be6322ef3a00ca4` | D1-compatible storage migration — complete, merged into `staging`. Not yet merged into `main`. |

Production: **not deployed**. Production requires separate, explicit
authorization from Tony (merging to `main` does not imply this).

## Cloudflare Staging deployment — live

The D1 storage migration is now wired to a real Cloudflare account and
deployed for QA (this was previously **BLOCKED, needs Tony** — see below for
what changed).

- **D1 database:** `instructor-assistant-db` (region ENAM), created via
  `wrangler d1 create`. `migrations/0001_init.sql` applied with
  `wrangler d1 migrations apply DB --remote` — verified live (`instructors`,
  `learners`, `lessons` tables present via `wrangler d1 execute`).
- **Real binding wired:** `lib/db.ts#getD1()` now returns the real `env.DB`
  D1 binding when running inside the deployed Worker (via
  `@opennextjs/cloudflare`'s `getCloudflareContext()`), falling back to the
  existing local `node:sqlite` adapter for `next dev`/`next build`/`npm
  test` — `lib/repo.ts` is unchanged, exactly as designed.
- **Deploy adapter added:** `@opennextjs/cloudflare` (OpenNext for
  Cloudflare) — the standard way to run a Next.js app on Cloudflare Workers.
  This required bumping `next` from `16.2.6` to `16.3.6` to satisfy the
  adapter's peer range (`>=16.3.3`); no other Next.js behavior change.
  New files: `open-next.config.ts`, `middleware.ts`. `wrangler.toml` gained
  `main`, `[assets]`, and a `WORKER_SELF_REFERENCE` service binding required
  by the adapter.
- **Staging URL:** `https://instructor-assistant.kunliu-work.workers.dev`
  (Cloudflare account: `Kunliu.work@gmail.com`).
- **Access protection:** Cloudflare Zero Trust **Access is not enabled on
  this Cloudflare account** — enabling it needs a one-time manual step in
  the dashboard (choosing a Zero Trust team name / plan) that an API token
  cannot do. As an interim measure until Tony does that one-time setup, the
  Staging URL is protected by **HTTP Basic Auth** (`middleware.ts`), with
  the username/password stored only as Cloudflare Worker secrets
  (`STAGING_BASIC_AUTH_USER` / `STAGING_BASIC_AUTH_PASSWORD`, set via
  `wrangler secret put` — never committed to git). Credentials were shared
  with Tony directly in chat, not in this repo.
  **Follow-up needed from Tony:** enable Zero Trust Access in the Cloudflare
  dashboard once, then this session (or a future one) can replace Basic Auth
  with a proper Access application restricted to Tony's email.
- **Remote QA performed against the live deployment:**
  - `npm run build` / `npm test`: PASS (12/12) after the `next` bump and
    adapter integration.
  - Unauthenticated request to `/` and `/api/learners`: **401** (Basic Auth
    enforced).
  - Authenticated request: **200**, app renders correctly.
  - Created a test instructor/learner/lesson through the live API against
    the real remote D1 database: lesson numbering, duration (90 min),
    distance (45 km), and cumulative totals all computed correctly by
    `lib/repo.ts` against the real `env.DB` binding.
  - Test data was deleted afterward (`DELETE FROM lessons/learners/
    instructors` via `wrangler d1 execute --remote`) — the Staging database
    is empty, ready for Tony's own QA.

## D1-compatible storage — merged into `staging`

`lib/repo.ts` now only depends on the `D1Database` interface
(`lib/d1-types.ts`): async `prepare().bind().first()/all()/run()`, the exact
shape of a real Cloudflare D1 binding. `migrations/0001_init.sql` +
`wrangler.toml` are the standard `wrangler d1 migrations` setup, verified
against a real local Miniflare D1 instance (`wrangler d1 migrations apply DB
--local`), fully offline. Locally (dev/test), `lib/db.ts#getD1()` returns a
D1-compatible adapter backed by `node:sqlite` (`lib/d1-sqlite.ts`) — swapping
in a real `env.DB` Cloudflare Worker binding needs no change to `lib/repo.ts`.

No CBT&A field or behavior changes: verified by `npm run build`, `npm test`
(12/12, including 2 new storage tests), and a full iPhone 13 E2E re-run
(Lesson #1/#2, cumulative totals, odometer carry-forward, reload
persistence) against the migrated storage.

**Known limitation:** D1 has no cross-call read-then-write transaction (only
`batch()` for pre-built, independent statements). Find-or-create-instructor
and lesson-number/cumulative-totals computation are therefore two sequential
calls, not one atomic unit — acceptable for this single-instructor-at-a-time
app; the unique constraints on `instructors.full_name` and
`lessons(learner_id, lesson_no)` still turn a race into a clear error rather
than silent data corruption.

**Deployment status: DEPLOYED to Cloudflare Staging.** See "Cloudflare
Staging deployment — live" above for the full picture (previously blocked on
Cloudflare account credentials; those were added to this environment and the
deployment is now done).

## CBT&A Checklist MVP — merged into `staging`

Merged from `feature/cbta-checklist` into `staging` for integration QA
(commit `ae1bc41`, superseded — `staging` now includes the D1 storage
migration on top, see above). Not yet merged into `main`; `main` still
requires Tony's explicit authorization for that step.

Implemented:

- Learner creation / selection
- Start Lesson
- End Lesson
- Lesson number (auto-incrementing)
- Date
- Start / finish time
- Start / finish odometer
- Automatic duration
- Automatic lesson km
- Cumulative hours
- Cumulative km
- Taught (free text)
- Competencies Assessed (free text)
- Achieved (free text)
- Location
- Comments
- ADI signature
- Learner signature
- Lesson history
- Previous lesson's finish odometer carried forward as next start odometer

Verification:

- `npm run build`: PASS
- `npm test`: 10/10 PASS
- End-to-end QA in an emulated iPhone 13 browser: PASS
  - Lesson #1 → Lesson #2 workflow: PASS
  - Reload persistence: PASS
  - No horizontal overflow: PASS

## Known limitations

- No instructor authentication yet in the app itself (Basic Auth on the
  Staging URL is a perimeter measure, not per-instructor login) — do not
  expose Production publicly without this.
- Zero Trust Access not yet enabled on the Cloudflare account (see above) —
  Basic Auth is an interim stand-in for Staging only.
- No public production deployment.
- Saved lessons cannot be edited or deleted.
- No offline mode / service worker.
- iOS home-screen icon is a basic SVG placeholder.
- `npm audit` on the pre-existing dependency set showed 2 high / 1 critical
  advisories before this session's `next` version bump; the bump to
  `16.3.6` (needed for the Cloudflare adapter) incidentally resolved all of
  them (`npm audit`: 0 vulnerabilities as of this deploy) — noted here per
  AGENTS.md §6, not something separately fixed.

## Old ACTGDS (`tony-kunliu/actgds.com`) cleanup

- Old Issue #2 ("ACTGDS Driver — CBT&A Checklist MVP"): **closed**, with a
  comment pointing to this repo.
- Old `feature/driver-cbta-checklist` branch: **retained** — branch deletion
  was attempted but the available credentials/tooling did not have permission
  to delete a remote ref. Left untouched as instructed.
- ACTGDS Production: **unchanged**.
