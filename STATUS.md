# STATUS.md

_Last updated: 2026-09-26_

Repo: `tony-kunliu/instructor-assistant`

| Branch | Commit | State |
| --- | --- | --- |
| `main` | `98aa0c047d9b99d309c531cddb81555f8444ab43` | Working rules / docs baseline only. CBT&A MVP and D1 storage not yet merged in. Not deployed. |
| `staging` | `8f99151180e4d56f60a8953e8f0338251a9d9b68` | CBT&A Lesson Checklist MVP + D1-compatible storage merged in for integration QA. Not deployed. |
| `feature/cbta-checklist` | `e7e2c3d93902d286e2bcd03e8ac08541cd6f7186` | CBT&A Lesson Checklist MVP — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/d1-storage` | `87b40be6258924329ae85f888be6322ef3a00ca4` | D1-compatible storage migration — complete, merged into `staging`. Not yet merged into `main`. |

Production: **not deployed**. Production requires separate, explicit
authorization from Tony (merging to `main` does not imply this).

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

**Deployment status: BLOCKED, needs Tony.** Actually running this against a
real Cloudflare D1 database and deploying a Staging/QA environment Tony can
open on his iPhone needs Cloudflare account credentials (e.g. a
`CLOUDFLARE_API_TOKEN` added as an environment secret) that this session does
not have — outbound network to `api.cloudflare.com` works, but there is no
account to authenticate as, so `wrangler d1 create`, `wrangler d1 migrations
apply --remote`, and any deploy command are not possible from here. No
public deployment was attempted without this. `wrangler.toml`'s
`database_id` is a placeholder Tony needs to replace with a real D1
database's id once created.

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

- No instructor authentication yet — do not expose publicly.
- Storage is D1-compatible (see above) but not yet wired to a real
  Cloudflare D1 database — blocked on Cloudflare credentials.
- No public production deployment.
- Saved lessons cannot be edited or deleted.
- No offline mode / service worker.
- iOS home-screen icon is a basic SVG placeholder.

## Old ACTGDS (`tony-kunliu/actgds.com`) cleanup

- Old Issue #2 ("ACTGDS Driver — CBT&A Checklist MVP"): **closed**, with a
  comment pointing to this repo.
- Old `feature/driver-cbta-checklist` branch: **retained** — branch deletion
  was attempted but the available credentials/tooling did not have permission
  to delete a remote ref. Left untouched as instructed.
- ACTGDS Production: **unchanged**.
