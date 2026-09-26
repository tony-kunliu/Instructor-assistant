# STATUS.md

_Last updated: 2026-09-26_

Repo: `tony-kunliu/instructor-assistant`

## Rollback baseline — recorded before `feature/instructor-identity` (Instructor Identity V1)

Recorded before any change in this round, per AGENTS.md-style rollback
discipline. If this round fails, restore to exactly this state.

- **Previous known-good `staging` HEAD:** `b6b749f` (docs-only commit
  recording the CBT&A PDF export remote QA).
- **Previous known-good Cloudflare Worker deployment:** Version ID
  `aa3c1c09-9892-4855-82d2-0e7fb1940d94` (`instructor-assistant`, deployed
  2026-09-26T11:15:46Z) — confirmed still the active/live deployment via
  `wrangler deployments list` immediately before this round started.
- **D1 migrations:** `wrangler d1 migrations list instructor-assistant-db
  --remote` → "No migrations to apply" — all of `0001_init.sql`,
  `0002_add_competency_events.sql`, `0003_add_lesson_updated_at.sql` are
  applied and the remote database is up to date with no pending migration.
- **Basic Auth confirmed working:** unauthenticated `GET /` → `401`;
  authenticated `GET /` (with the existing Basic Auth credentials) → `200`.
- **Rollback path if this round needs to be reverted:** redeploy Worker
  Version `aa3c1c09-9892-4855-82d2-0e7fb1940d94` via `wrangler rollback` (or
  redeploy from `staging` at `b6b749f`); D1 migrations are additive-only so
  no migration rollback is needed to restore this baseline; Basic Auth
  middleware/secrets are untouched by this round until explicitly replaced,
  so restoring the old Worker version alone restores Basic Auth protection.
  No existing `learner`/`lesson` data is touched by this round, so no data
  rollback is ever needed.
- **Rollback path verified available (not exercised — Staging was left
  running, not deliberately broken to test this):** `wrangler deployments
  list` after this round's deploy still shows Version
  `aa3c1c09-9892-4855-82d2-0e7fb1940d94` in the account's deployment
  history, so `wrangler rollback` (or redeploying `staging` at `b6b749f`)
  remains available if ever needed. This round's own new deployment is
  Version `92537c0a-b47a-4b60-ae40-465132e22c8e` (see "Instructor Identity
  V1" section below for the full record) — that's the new baseline if a
  future round needs to roll back only past *this* round instead.

| Branch | Commit | State |
| --- | --- | --- |
| `main` | `98aa0c047d9b99d309c531cddb81555f8444ab43` | Working rules / docs baseline only. CBT&A MVP, D1 storage, Cloudflare deployment, CBT&A V2/V3, and PDF export not yet merged in. Not deployed. |
| `staging` | `ad89cd5` | CBT&A Lesson Checklist MVP + D1-compatible storage + live Cloudflare Staging deployment + CBT&A V2 structured competency selection + CBT&A V3 history editing / corrected Final Drive gating + official CBT&A PDF export + Instructor Identity V1 (data model + lesson attribution). |
| `feature/cbta-checklist` | `e7e2c3d93902d286e2bcd03e8ac08541cd6f7186` | CBT&A Lesson Checklist MVP — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/d1-storage` | `87b40be6258924329ae85f888be6322ef3a00ca4` | D1-compatible storage migration — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/cbta-competency-selection` | `b2734f5c9b6cbe6d9d5ff85c3fdf16fc74e42adb` | CBT&A V2 structured competency selection — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/history-edit-and-finaldrive-gating` | `d1b01ef` | CBT&A V3 history lesson editing + corrected Final Drive 23 / Review gating — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/cbta-pdf-export` | `013a805` | Official ADI CBT&A Checklist PDF export — complete, merged into `staging`. Not yet merged into `main`. |
| `feature/instructor-identity` | `8ae6a01` | Instructor Identity V1 data model + lesson attribution (Cloudflare Access itself deferred — see STATUS.md section) — complete, merged into `staging`. Not yet merged into `main`. |

Production: **not deployed**. Production requires separate, explicit
authorization from Tony (merging to `main` does not imply this).

## Instructor Identity V1 — Cloudflare Access wired up (this session, follow-up round)

Tony enabled Cloudflare Zero Trust Access in the dashboard (the one-time
manual step the previous round was blocked on). Re-verified via `GET
/accounts/:id/access/apps` — no longer `access.api.error.not_enabled`, so
the rest of this round is done entirely via API/CLI, per instruction not to
have Tony do anything Claude can safely automate.

- **Access Application created** (`POST /accounts/:id/access/apps`):
  `self_hosted` app named "Instructor Assistant Staging", domain
  `instructor-assistant.kunliu-work.workers.dev` (the Worker's own
  workers.dev hostname — no custom zone exists on this account). App id
  `d63c5b8e-b4d5-4ce0-815e-0381381d709d`, AUD
  `dbaecdf29cb50d215f3edbb3b260b2c85209db78728fb19e3c53c39c5d9759e3`. Team
  domain (auto-provisioned when Tony enabled Access): `actgds.
  cloudflareaccess.com`.
- **Access Policy created**: `decision: allow`, `include` = exactly
  Tony's and Anna's real emails (the same two provided in the previous
  round) — no other email can authenticate against this app at all. No
  identity provider was explicitly configured; Access's built-in
  "One-time PIN" email login is used by default, which is enough for two
  named individuals and adds no new third-party dependency.
- **Verified live immediately after creating the app** — an unauthenticated
  `curl` to the Staging URL now gets a `302` redirect to `https://actgds.
  cloudflareaccess.com/cdn-cgi/access/login/...` *before* the request ever
  reaches the Worker. This is a stronger perimeter than before: Access now
  blocks at Cloudflare's edge, ahead of both the app and the existing Basic
  Auth middleware.
- **`lib/access.ts` (new):** `verifyAccessIdentity(request)` — reads the
  `Cf-Access-Jwt-Assertion` header Cloudflare Access attaches to any
  request that passed its policy, and verifies it ourselves (RS256
  signature against Access's own JWKS at `https://actgds.
  cloudflareaccess.com/cdn-cgi/access/certs`, `aud` + `iss` checked) before
  ever trusting the `email` claim inside it — never trusts the header at
  face value, exactly as instructed. Uses `jose` (new dependency) for JWT
  verification, the same library Cloudflare's own Access docs recommend
  for Workers. Returns `null` when the header is absent (local dev, or any
  request not behind this Access app) so nothing breaks outside of
  Staging.
- **`middleware.ts` rewritten** to two independent layers: (1) Access
  identity, verified as above and mapped to an instructor via
  `findInstructorByEmail` — an Access-passed request whose email has no
  matching *active* instructor gets `403` here too (defense in depth
  beyond Access's own policy; still never auto-creates an instructor for
  an unrecognized identity); on success, the resolved instructor id/name
  are set as trusted `x-instructor-id`/`x-instructor-name` request headers
  forwarded to route handlers (never client-submitted — set here, after
  our own verification). (2) HTTP Basic Auth, **kept exactly as before,
  not removed** — the cautious migration order from the previous round's
  STATUS.md said not to retire it until the identity path is proven; both
  gates are independent, so if Access is ever misconfigured, Basic Auth
  alone still protects the app, and if Basic Auth secrets are ever lost,
  Access alone still does.
- **Lesson attribution now automatic through Access**, not just
  passable-by-hand: `lib/api.ts#readJsonWithActor` overrides any
  client-submitted `actingInstructorId` in the request body with the
  trusted `x-instructor-id` header whenever one is present, so a signed-in
  Tony/Anna's lesson creates/edits are attributed correctly without the
  client needing to know or send anything about identity itself. A request
  with no Access identity (local dev, tests) falls back to whatever the
  body says, unchanged from the previous round.
- **`GET /api/me` (new)** + a minimal "Signed in as `<name>`" line in the
  app's topbar (`app/driver-app.tsx`) — reads the same trusted headers,
  shows nothing when there's no Access identity for this request. No
  profile/settings page, per instruction.
- **Verification:** `npm run build` / `npm test`: PASS (61/61 — 6 new
  tests in `tests/access.test.ts` covering: no-header → `null`; a
  correctly signed token verifies and extracts the email; wrong audience
  rejected; expired token rejected; a token signed by a different key
  (forged signature) rejected; a verified token with no `email` claim
  rejected. Uses a locally generated RSA key pair + `jose`'s
  `createLocalJWKSet` to simulate Access's JWKS without depending on the
  real Access service in tests). All 55 pre-existing tests (including last
  round's `tests/instructor-identity.test.ts`) still pass unchanged.
- **Not built:** an identity provider beyond Access's default One-time PIN
  (not needed for two named individuals); any UI beyond the one-line
  "Signed in as"; removal of Basic Auth (deliberately kept, per the
  migration order).

## Instructor Identity V1 — data model + lesson attribution (this session)

Goal (per Tony's instruction): Cloudflare Access → authenticated email →
Instructor record → lesson/history edit attribution, first batch Tony +
Anna only. **This round's actual scope, per Tony's own decision when asked
mid-round: data model + lesson/history attribution only — Cloudflare
Access itself is deferred.**

- **Why Access is deferred:** Cloudflare Zero Trust Access is **not yet
  enabled** on this account (`Kunliu.work@gmail.com`) — confirmed via
  `GET /accounts/:id/access/apps` → `access.api.error.not_enabled: ...
  click the 'Enable Access' button`. Enabling it is a one-time manual
  dashboard action Cloudflare requires from the account owner and cannot be
  done via API token. When asked how to proceed, Tony chose: do the data
  model and lesson attribution now, leave Access itself for a later round.
  No Cloudflare API token permissions were expanded to work around this.
- **Data model (additive, `migrations/0004_instructor_identity.sql`):**
  - `instructors.status` (`'active' | 'inactive'`, app-validated, defaults
    to `'active'`) — lets an instructor be deactivated without deleting
    history.
  - `lessons.updated_by_instructor_id` (nullable, `REFERENCES
    instructors`) — which instructor last edited a history lesson.
  - Seeds exactly two named instructor rows, **Tony** and **Anna**, with
    the real login emails Tony provided directly in this session
    (`Kunliu.work@gmail.com` / `yapingqu.work@gmail.com`) — this is the
    email→instructor config the future Access integration will read.
    **Existing instructor rows are untouched**: the real production
    instructors already in the database (`ADI601`, `ADI604`) are not
    renamed, merged, or guessed into "Tony"/"Anna" — per instruction, and
    verified by test (`tests/instructor-identity.test.ts`, "does not touch
    any pre-existing instructor row").
  - `lib/repo.ts#findInstructorByEmail` — the exact lookup a future
    Cloudflare Access JWT-verified-email step will call once wired up;
    unknown or inactive emails resolve to `null`, and the caller must
    refuse app access rather than auto-create an instructor for them (no
    such caller exists yet, since there's no Access integration this
    round — this is the function it will call).
- **Lesson attribution (`lib/repo.ts`):**
  - `createLesson` / `updateLesson` accept an optional `actingInstructorId`
    on the request body. If supplied, it must reference an existing,
    *active* instructor (`resolveActingInstructorId` — never trusts a
    client-submitted name/email, only a real instructor id already in the
    database) or the request is rejected with a `ValidationError`.
  - **Create:** `actingInstructorId`, if supplied, becomes the lesson's
    `instructor_id` (who actually taught it); omitted falls back to the
    learner's own instructor, exactly as before — fully backward
    compatible with existing callers/tests.
  - **Edit:** `actingInstructorId`, if supplied, is written to
    `updated_by_instructor_id`; **omitted leaves it exactly as it was**
    (`COALESCE` in the `UPDATE`) — never cleared, never guessed, per
    instruction. Editing someone else's lesson never rewrites the
    original `instructor_id`.
  - `listLessons` / `listLessonsForExport` / `getLesson` now also return
    `updatedByInstructorId` + `updatedByInstructorName` (`LEFT JOIN` —
    `null` for never-edited lessons or lessons edited before this shipped,
    never guessed). History UI shows "Edited `<timestamp>` · Last edited
    by `<name>`" when known (`app/driver-app.tsx`).
  - **No client identity is trusted for security** — nothing about
    `actingInstructorId` is used as an access-control decision this round;
    Basic Auth remains the only perimeter protection (unchanged), so this
    field is bookkeeping/attribution only, not authentication, until real
    Cloudflare Access is wired in.
- **Not built this round, per Tony's own scope decision:** the Cloudflare
  Access application itself (can't be configured via API until Access is
  enabled — confirmed above); any "Signed in as Tony/Anna" UI (would need
  real Access-verified identity to be honest, not a stand-in selector);
  wiring `actingInstructorId` into the app UI automatically (there is
  nothing yet to source it from without Access) — the backend plumbing is
  ready and tested, waiting for the identity source.
- **Verification:** `npm run build` / `npm test`: PASS (55/55 — 14 new
  tests in `tests/instructor-identity.test.ts` covering: Tony/Anna email
  resolution (case-insensitive), unknown/inactive email resolves to
  nothing, lesson creation attributed to Tony vs Anna vs the old
  fallback-to-learner's-instructor behavior, a rejected unknown
  `actingInstructorId` on both create and edit, an edit by one instructor
  never rewriting another lesson's original `instructor_id`, `updated_at`
  +`updatedByInstructorId`/`Name` surfaced correctly after an edit, a
  second edit with no `actingInstructorId` preserving the prior
  attribution rather than clearing it, and pre-existing instructor rows
  left untouched). All pre-existing suites (competency rules, PDF export,
  history edit, odometer/cumulative math, signatures) still pass
  unchanged, after two small test updates for the two new seeded
  instructor rows always being present (`tests/d1-storage.test.ts`'s row
  count and id-ordering assertions).
- **Deployed and remote-QA'd:** merged into `staging` as `ad89cd5`
  (feature commit `8ae6a01`), migration `0004_instructor_identity.sql`
  applied to the real remote D1, deployed to Cloudflare Staging via
  `npm run cf:deploy` (Version ID `92537c0a-b47a-4b60-ae40-465132e22c8e`).
  Verified against the real, live D1 database using an isolated,
  clearly-named test learner (`ZZ_QA_IDENTITY_TEST_DELETE_ME`, owned by a
  throwaway `ZZ_QA_FILE_INSTRUCTOR_DELETE_ME` — deliberately *not* Tony or
  Anna, so the test actually exercises cross-instructor attribution):
  - Unauthenticated `GET /` and `GET /api/learners` → `401` (unchanged).
  - `GET /api/instructors` (authenticated) shows the real seeded Tony/Anna
    rows with their real emails, alongside the untouched `ADI601`/`ADI604`
    rows.
  - **E:** lesson created with `actingInstructorId` = Tony's real remote id
    → `instructor_id` = Tony.
  - **F:** lesson created with `actingInstructorId` = Anna's real remote id
    → `instructor_id` = Anna.
  - **G:** Anna edited Tony's Lesson #1 (real PATCH against real D1) →
    `instructor_id` stayed Tony's, `updated_by_instructor_id` became
    Anna's — verified directly in the API response.
  - **H:** the learner's lesson list shows `updatedByInstructorName:
    "Anna"` on the edited lesson, `null` on the never-edited one.
  - CBT&A PDF export (existing feature) still returns `200` with correct
    data for this multi-lesson, multi-instructor-attributed learner — no
    regression.
  - All QA rows (2 lessons, 1 learner, 1 throwaway instructor) were then
    deleted from the remote D1; Tony's real learners ("Kun Liu", "V1test")
    and the real Tony/Anna/ADI601/ADI604 instructor rows were confirmed
    present and unchanged both before and after.

## CBT&A PDF export — merged into `staging`

One-click export of the official ACT "Competency Based Training and
Assessment Lesson Checklist" (form 10,044 (7/2002)) for a learner, filled
with their saved lesson history, built entirely client-side with pdf-lib.

- **Template fidelity:** the exact PDF Tony supplied is committed at
  `public/pdf-template/adi-cbta-checklist.pdf` and its pages are *copied*
  into the output (never redrawn) — page size, orientation, columns,
  header and first-page/continuation-page structure are all the original
  template's own. Page 1 holds 5 lesson rows (with the ADI/student header);
  every continuation page holds 6. Geometry (column x-bounds, row
  y-offsets, header field boxes) was measured directly from the template's
  own vector rects/text and lives as pure data in `lib/pdf-layout.ts`.
- **Data exported:** ADI name/number, student details, Date/Lesson No.,
  Start/Finish time + cumulative hours, Start/Finish odometer + cumulative
  km, Taught/Assessed/Achieved (verbatim — old free-text lesson records are
  never reinterpreted into competency events), Location/Comments, the
  matching ADI/Learner signature images (scaled to fit each cell, aspect
  ratio preserved, never stretched or reused across lessons), and page
  numbers on every page. Review 1-17 / Review 1-22 / 23 Final Drive already
  render as distinct text labels (not plain numbers) since that's how
  `lib/competency.ts#competencyLabel` formats them — visually distinct in
  the PDF automatically.
- **Only saved data, current version:** exports the learner's saved lessons
  in `lesson_no` order via a new `listLessonsForExport` (never a draft);
  since it queries the database fresh each time, editing a history lesson
  (CBT&A V3) and exporting again reflects the new odometer/time/cumulative/
  content/signatures immediately — verified directly.
- **Missing ADI number handled explicitly:** `instructors.adi_number`
  existed in the schema but was never surfaced anywhere in the app. Now
  exposed on `Instructor`/`Learner` and editable via a new `PATCH /api/
  instructors/:id`. If missing when exporting, the UI shows a one-field
  prompt to fill it in before the PDF is built — no fabricated data.
- **Nothing silently cut:** a Taught/Assessed/Achieved/Location/Comments
  value that doesn't fit its cell gets a "(see Additional Notes page)"
  marker and its full, untruncated text on an appendix page (labelled by
  lesson number and field), continuing the same page-number sequence as
  the main checklist. English and Chinese render correctly in the same
  cell (word-wrap for Latin, character-by-character fallback for unspaced
  CJK runs) via an embedded, licensed CJK font (Noto Sans CJK SC, SIL OFL
  1.1, `public/fonts/`).
- **Access:** the new `GET /api/learners/:id/export` (and everything else)
  sits behind the same site-wide Basic Auth as the rest of the app (see
  `middleware.ts`) — no public PDF link is ever created, and no data is
  sent to a third-party PDF service (pdf-lib runs entirely in the
  requesting browser).
- **A real, non-obvious bug found and fixed by this round's own visual QA:**
  the embedded CJK font substitutes digits for context-dependent alternate
  glyphs via the OpenType `locl` (localized forms) feature, which pdf-lib's
  declared PDF `/W` width table doesn't cover — every digit rendered with a
  large, wrong gap after it. Caught by actually rendering sample PDFs to
  images and reading them (not just checking the file was produced), and
  confirmed independently in two unrelated PDF renderers (poppler and
  Chromium's PDFium) before concluding it wasn't a viewer quirk. Fixed by
  embedding with `{ features: { locl: false } }`; a regression test
  (`tests/pdf-export.test.ts`) encodes the root cause directly.
- **Verification:** `npm run build` / `npm test`: PASS (41/41, new
  `tests/pdf-export.test.ts` covers 0/1/5/6/11/12-lesson pagination, an
  empty-lesson-list rejection, an overflow-appendix case, and the digit/
  `locl` regression). Sample PDFs for every row count were rendered to
  images and read page by page — header fields, cumulative math, mixed
  Chinese/English text, Review/Final-Drive labels, two independently
  distinguishable signatures per lesson, and the appendix page all
  verified correct, with no overlap, cropping, or misalignment across
  pages. Full mobile E2E (iPhone 13 viewport) against the real running
  app: 0-lesson message shown correctly; missing-ADI-number prompt shown;
  saving it triggers a real PDF download (verified as a valid `%PDF-...`
  file); a second export (ADI number now set) downloads directly. This is
  emulated-browser verification only — Tony's own on-device check (opening
  the downloaded PDF on his iPhone) is still needed before treating mobile
  PDF viewing/saving as fully confirmed.
- **Deployed and remote-QA'd:** merged into `staging` as `ee9633c`
  (feature commit `013a805`), deployed to Cloudflare Staging
  (`https://instructor-assistant.kunliu-work.workers.dev`, Version ID
  `aa3c1c09-9892-4855-82d2-0e7fb1940d94`). Verified against the real,
  live D1 database using an isolated, clearly-named test learner/
  instructor/lesson (`ZZ_QA_TEST_DELETE_ME` / `ZZ_QA_INSTRUCTOR_DELETE_ME`):
  confirmed the unauthenticated export endpoint returns 401, confirmed
  `GET /api/learners/:id/export` returns the correct real data (including
  the ADI number set via the new PATCH endpoint and both real signature
  images), and built a real PDF from that live export response — rendered
  and visually checked, correct. All QA test rows were then deleted from
  the remote D1 (`competency_events` → `lessons` → `learners` →
  `instructors`), and Tony's real learners ("Kun Liu", "V1test") were
  confirmed still present and untouched, both before and after.

## CBT&A V3 — history lesson editing + corrected Final Drive gating — merged into `staging`

Two things, both requested together by Tony as one round:

**1. Every history lesson is now editable** (previously write-once).
`PATCH /api/learners/:id/lessons/:lessonId` (`lib/repo.ts#updateLesson`)
lets an instructor fix a past lesson's Date, Start/Finish time, Start/Finish
odometer, Taught, Assessed, Achieved, Location and Comments.

- **Never user-editable, always recalculated:** Lesson number (stays as
  assigned at creation), Duration, Distance, Cumulative hours, Cumulative
  km. Editing one lesson's time/odometer recalculates its own duration/
  distance and cascades a recomputed cumulative total through every
  subsequent lesson (running sum in `lesson_no` order) — all committed in
  one atomic `db.batch()` with the swapped competency events.
- **Carry-forward / consistency protection:** since the odometer is one
  physical instrument, an edit is rejected if it would make this lesson's
  start odometer less than the previous lesson's finish odometer, or this
  lesson's finish odometer exceed the next lesson's start odometer.
- **Signature invalidation:** changing any of Date / Start-Finish time /
  Start-Finish odometer / Taught / Assessed / Achieved / Location /
  Comments invalidates both existing signatures — the edit is rejected
  unless both a new ADI signature and a new Learner signature are supplied
  and are byte-different from the previous ones (proof they were actually
  redrawn, not resubmitted). Enforced server-side
  (`lib/repo.ts#updateLesson`), not just hidden in the UI.
- **`lessons.updated_at`** (new nullable column, `migrations/
  0003_add_lesson_updated_at.sql`) records when a lesson was last edited;
  `null` until first edited. No login system was built for this (per
  instruction) — edits aren't attributed to a specific person, only timed.
- **Automatic milestone rollback:** progress (Review 1-17 / Review 1-22 /
  23 Final Drive / CBT&A Completed) is always *derived fresh* from the full
  competency-event history on every read (`lib/competency.ts
  #computeProgress`), never cached — so editing an earlier lesson to remove
  a competency's Achieved status automatically invalidates any
  later-recorded Review/Final-Drive/Completed milestone that depended on
  it, the moment progress is next computed. `updateLesson` diffs
  before/after progress and returns an explicit `invalidated` report
  (`{ review1_17, review1_22, finalDrive23, completed }`); the UI shows a
  clear warning banner on the Progress card naming exactly what was rolled
  back and reset to Locked/Ready.

**2. Corrected 23 Final Drive gating** (this was wrong in the V2 round —
Final Drive had no lock at all). Now: 23 Final Drive is **Locked** until
Competency 1-22 are all Achieved **and** Review 1-17 is Achieved **and**
Review 1-22 is Achieved; only then is it **Ready to assess**. Review 1-17
and Review 1-22's own gating is unchanged (1-17 all Achieved unlocks
Review 1-17; 1-22 all Achieved + Review 1-17 Achieved unlocks Review
1-22) but is now re-validated the same way on every read (see above), not
just at the moment it was first assessed.

**Tests:** `tests/history-edit.test.ts` (new) covers editable fields
taking effect, lesson-number/duration/distance/cumulative always being
recalculated regardless of what's smuggled into the input, cascading
cumulative recalculation to subsequent lessons, carry-forward odometer
consistency rejection, signature invalidation (same signature resubmitted
→ rejected; only one of the two redrawn → rejected; both redrawn →
accepted; no protected field changed → no forced re-sign), an edit that
retroactively invalidates an already-Achieved Review 1-17 (with the
`invalidated` flag and rollback both verified), and that an unrelated edit
reports no invalidation. `tests/competency.test.ts` gained the corrected
Final Drive 23 gating tests (locked until fully unlocked; achieves +
completes only after unlock) replacing the old ungated version. All
pre-existing tests (CBT&A V2 rules, Lesson #1/#2 duration/distance/
cumulative/odometer-carry-forward) still pass unchanged.

**Bug caught by this round's own mobile E2E, fixed before it shipped:**
the CompetencyPicker refactor for 3-state Final Drive initially had
`specialStatus()` fall through to Final Drive's lock status for *any*
unmatched id — which included every core competency 1-22, disabling their
Assessed chip entirely whenever Final Drive was locked (i.e. almost
always). Fixed to return `null`/not-special for non-special ids before
this ever reached Staging.

**Verification:** `npm run build` / `npm test`: PASS (31/31). Full mobile
E2E (iPhone 13 viewport): create Lesson #1 → edit its finish odometer (a
protected field) → save rejected without re-signing → save rejected with
only one signature redrawn → both redrawn → saved → duration/distance
recalculated correctly (odometer 1000→1030 became 30 km, up from 10 km) →
history shows the new `Edited <timestamp>` line → Final Drive 23 correctly
shows "Locked · N competencies remaining" (previously wrongly "Ready to
assess") → no horizontal overflow at 390px width.

## CBT&A V2 — structured competency selection — merged into `staging`

Replaces free-text Taught / Competencies Assessed / Achieved with a
mobile chip-based picker and full server-side rule enforcement. Rules
implemented exactly as specified by Tony (no invented competency names —
only official numbering 1–22, Review 1-17, Review 1-22, 23 Final Drive):

- Every learner has Competency 1–22, each trackable as Taught / Assessed /
  Achieved. A competency can be Taught repeatedly across different lessons
  (full history kept); the same lesson can never Taught + Assess the same
  competency; Achieved requires the competency to be Assessed in that same
  lesson; once Achieved, a competency can no longer be Taught (server
  validated, not just hidden in the UI).
- Review 1-17 unlocks once Competency 1-17 are all Achieved. Review 1-22
  unlocks once Competency 1-22 are all Achieved **and** Review 1-17 is
  Achieved. Both have Assessed/Achieved only, no Taught. Locked reviews are
  rejected server-side even if the UI is bypassed.
- 23 Final Drive keeps its existing (ungated) Assessed/Achieved-only
  behavior — no new unlock rule invented, per instruction. Assessed +
  Achieved marks the learner's CBT&A as Completed and records
  completed-at, the completing lesson, instructor, total lessons,
  cumulative hours and cumulative km (derived from `competency_events` +
  the completing lesson's own cumulative totals — no extra table needed).
- **Data model:** new `competency_events` table (`migrations/
  0002_add_competency_events.sql`, kept in sync with `lib/schema.ts` — see
  `tests/d1-storage.test.ts`) records every Taught/Assessed event
  individually (learner, lesson, competency, action, result, timestamp).
  Progress is derived from this full history (`lib/competency.ts`), so
  "how many times was X taught, and when" stays answerable. The lesson
  row's existing `taught` / `competencies_assessed` / `achieved` text
  columns are kept (now server-computed from the structured ids, e.g.
  `"3, 8, 12"`) so old lesson history, the history view and any future PDF
  export keep working unchanged.
- **UI:** number chips (`app/competency-picker.tsx`) for Taught and
  Assessed, mutually exclusive and achieved-aware; an Assessment Result
  step (Achieved / Not achieved) only for competencies Assessed this
  lesson; a learner-level `CBT&A Progress` card (`app/competency-
  progress.tsx`) with a 1-22 grid, Review 1-17 / Review 1-22 / Final Drive
  23 status, and a Completed banner. No PDF export, no GPS/Drive
  Intelligence, no login/booking/AI/voice — out of scope this round, per
  instruction (roadmap only, in TASK.md history).
- **Tests:** `tests/competency.test.ts` covers repeated Taught across
  lessons, Taught/Assessed mutual exclusion, Achieved requiring Assessed in
  the same lesson, no re-Taught after Achieved, Review 1-17 locked/unlocked,
  Review 1-22 locked (1-22 achieved but Review 1-17 not) and unlocked, and
  Final Drive 23 → Completed with a correct completion summary.
  `tests/workflow.test.ts` (existing Lesson #1/#2 duration/distance/
  cumulative/odometer-carry-forward assertions) still passes unchanged in
  substance, updated only to call the new structured `taughtIds`/
  `assessedIds`/`achievedResults` fields instead of free text.
- **Verification:** `npm run build` / `npm test`: PASS (22/22). Full mobile
  E2E (iPhone 13 viewport, Playwright, temporary local install — not added
  as a project dependency): select learner → Start Lesson → pick Taught →
  pick Assessed → mark Achieved → End Lesson → sign → Save → reload →
  verified history and CBT&A Progress card both correct. No horizontal
  overflow at 390px width (`scrollWidth === clientWidth`).
- **Local dev note:** `next.config.ts`'s `initOpenNextCloudflareForDev()`
  (added for the Cloudflare deployment) means `next dev` now talks to a
  local Miniflare-emulated D1, not the `node:sqlite` fallback — so a fresh
  clone needs `wrangler d1 migrations apply DB --local` once before
  `next dev` will work. `npm test` is unaffected (it calls `openTestD1()`
  directly). Documented here since it was discovered while running this
  round's mobile E2E; not itself part of this round's task.

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
- **Instructor Identity V1 is data-model-only this round** — no UI sources
  `actingInstructorId` yet (nothing to source real, verified identity from
  without Cloudflare Access), so today's app UI still behaves exactly as
  before this round (lessons created via the UI still default to the
  learner's own instructor; history edits via the UI still don't set
  `updated_by_instructor_id`). The backend is ready and tested
  (`tests/instructor-identity.test.ts`) for the moment Access supplies a
  verified email → `lib/repo.ts#findInstructorByEmail` → `actingInstructorId`.
- Pre-existing production instructor rows (`ADI601`, `ADI604`) have `email:
  null` — nobody has confirmed which real person those correspond to, so
  no email was guessed onto them. They'll need a real email set (e.g. via
  the existing `PATCH /api/instructors/:id`-style endpoint, once extended,
  or directly) once Tony confirms their identity.
- No public production deployment.
- Saved lessons can be edited (CBT&A V3) but not deleted.
- No offline mode / service worker.
- iOS home-screen icon is a basic SVG placeholder.
- The embedded CJK font for PDF export (`public/fonts/NotoSansSC-Regular.otf`)
  is ~16 MB, needed for full Chinese character coverage and only fetched by
  the browser when Export is actually clicked (not part of the main app
  bundle); the *exported* PDF itself stays small since only the glyphs
  actually used get embedded.
- `npm audit` on the pre-existing dependency set showed 2 high / 1 critical
  advisories before this session's `next` version bump; the bump to
  `16.3.6` (needed for the Cloudflare adapter) incidentally resolved all of
  them (`npm audit`: 0 vulnerabilities as of this deploy) — noted here per
  AGENTS.md §6, not something separately fixed.
- Next.js 16's dev server auto-appends an "agent rules" block to `AGENTS.md`
  on `next dev` startup (a first-party Next.js feature, see `node_modules/
  next/dist/server/lib/generate-agent-files.js`). Discovered while running
  this round's local E2E and discarded before committing — `AGENTS.md` is
  Tony's governance doc, not something a dev-tool side effect should
  silently rewrite. Noted per AGENTS.md §6; not fixed (nothing to fix, just
  don't commit it).

## Old ACTGDS (`tony-kunliu/actgds.com`) cleanup

- Old Issue #2 ("ACTGDS Driver — CBT&A Checklist MVP"): **closed**, with a
  comment pointing to this repo.
- Old `feature/driver-cbta-checklist` branch: **retained** — branch deletion
  was attempted but the available credentials/tooling did not have permission
  to delete a remote ref. Left untouched as instructed.
- ACTGDS Production: **unchanged**.
