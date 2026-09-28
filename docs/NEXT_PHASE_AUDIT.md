# Next-Phase Product Audit (2026-09-28)

Read-only product/project assessment, run after Integration V1 non-Production
E2E QA reached PASS. No code was changed by this audit. See `TASK.md` /
`STATUS.md` for current live task state — this file is a standing reference
for the next MVP decision, not a task tracker.

## Current foundation

Learner + lesson management; CBT&A competencies 1-22, Review 1-17, Review
1-22, Final Drive 23 with derived-only duration/km/cumulative totals and
lesson numbering; History Edit with downstream recalculation; per-lesson ADI
+ learner signatures (cleared and re-collected whenever protected content
changes); CBT&A Checklist PDF export; Cloudflare Access-gated sign-in with
instructor identity attribution; Integration V1 Sender (`lesson.upserted` to
ACTGDS), contract-compatible, deployed to Staging only, non-Production QA
PASS; manual "Copy Integration ID" for Tony's own CRM linking.

## Remaining instructor pain points

1. **Learner selection is the highest-frequency friction point and it's
   already a foundation gap, not a future roadmap phase.** Every lesson
   starts by picking a learner from one flat `<select>` — every active
   learner from every instructor, all mixed together, alphabetical, no
   filter, no search. With two instructors (Tony + Anna) today, this is
   already daily friction; it degrades further with any roster growth.
2. **No learner lifecycle/archive, even though the schema already supports
   it.** `learners.archived_at` exists in the schema and `listLearners`
   already excludes archived rows — but nothing in the product ever sets
   `archived_at`. A learner who completes Final Drive 23 (the app already
   computes `CompletionSummary` for this) stays in the active picker
   forever, permanently growing the list and the wrong-student data-entry
   risk during a lesson.
3. No "my learners" default for the signed-in instructor — everyone sees
   everyone's roster by default.
4. No booking/schedule pre-population ("Today's Lessons") — correctly out
   of reach until P3 (Booking → Instructor Assistant) delivers real data
   from ACTGDS/Cal.com; building a local approximation now would be
   speculative and is not recommended.
5. No school-owner (Tony) cross-instructor summary/reporting view. Real, but
   lower frequency than per-lesson learner selection — a reporting feature,
   not a per-lesson workflow blocker.

## Highest-value next MVP

**Learner List Usability & Lifecycle**: default the picker to the signed-in
instructor's own active learners (with an explicit "all learners" toggle for
Tony), add a simple name filter/search, and add an explicit Archive action
(using the existing `archived_at` column) — surfaced as a suggested action
once a learner's `CompletionSummary` shows Final Drive 23 achieved, but
always available manually too.

## Why this comes next

- It fixes the single interaction every instructor performs at the start of
  **every lesson**, so the workload reduction is measurable and recurring,
  not one-off.
- It closes a gap in the *existing* foundation (`archived_at` already
  modeled, never wired to any UI/action) rather than opening a new
  subsystem.
- It needs no new database migration, no ACTGDS coordination, and no
  Integration V1 contract change — `archived_at` and `instructor_id` are
  already persisted; the `lesson.upserted` contract carries no learner
  archive/status field (confirmed against
  `docs/integrations/actgds-instructor-assistant-v1.md`), so filtering or
  archiving locally cannot break or need to renegotiate the contract.
- It's small enough to land, verify, and QA in one focused task, matching
  `AGENTS.md`'s one-feature-per-branch discipline — unlike GPS (P4/P5) or
  Booking (P3), which are genuinely larger and/or blocked on the other repo.

## MVP scope

- Learner picker: default filter to signed-in instructor's own active
  learners; explicit toggle to view all instructors' active learners
  (needed for Tony as owner, and as a fallback with no Access identity in
  local dev).
- Client-side name search/filter over the currently-shown list.
- "Archive learner" action (sets `archived_at`, already excluded from
  `listLearners`); a visible suggestion (not a forced/automatic action) when
  `CompletionSummary` indicates Final Drive 23 is achieved.
- Archived learners remain fully readable in the database/history/PDF
  export — this is a visibility filter, never a delete.

## Explicitly not in MVP

- Any change to the `lesson.upserted` Integration V1 contract or payload.
- Booking/Cal.com pre-population ("Today's Lessons") — needs P3 first.
- GPS, Drive Intelligence, or Driving Journey (P4-P6).
- Owner-level cross-instructor reporting dashboard.
- Un-archiving UI (can be added later if Tony needs it; not blocking).
- Bulk archive / bulk operations.

## Database/migration impact

None. `archived_at` (learners) and `instructor_id` are already part of the
applied schema (Staging migration level `0005`). No new column, table, or
migration is required.

## Integration V1 impact

NONE. Archive/filter state is not part of the `lesson.upserted` contract and
never crosses to ACTGDS. No Sender, outbox, schema, or fixture change.

## ACTGDS coordination required

NO.

## Recommended implementation sequence

1. Add "my learners" default filter + explicit "all learners" toggle to the
   learner picker (uses data already returned by `/api/instructors` +
   `/api/me`).
2. Add client-side name search/filter over the picker list.
3. Add an "Archive learner" action/endpoint (sets `archived_at`), surfaced
   as a suggestion when `CompletionSummary` is present, always available
   manually from the learner detail view.
4. Focused QA: picker defaults correctly per signed-in instructor, toggle
   works, archived learners disappear from the active picker but remain
   fully intact in history/PDF/DB, Integration V1 payloads are unaffected.

## Later roadmap

- P1 Student Account, P2 Lesson Notification, P3 Booking → Instructor
  Assistant (per `docs/ECOSYSTEM_ROADMAP.md` — ACTGDS-coordinated).
- Owner-level cross-instructor summary/reporting for Tony.
- P4 GPS Tracking V1, P5 Drive Intelligence, P6 Driving Journey — correctly
  deferred; no measurable instructor-workload case yet, largest scope/risk.
- PDF share/email-from-device convenience (low urgency, no workload case
  strong enough to prioritize over the above).

## Recommended next task

Tony's go-ahead to scope and branch the "Learner List Usability & Lifecycle"
MVP as its own `feature/*` branch, following the normal
`feature/* → staging → main → Production` flow and `AGENTS.md` task
workflow. No implementation has started; this document is planning input
only.
