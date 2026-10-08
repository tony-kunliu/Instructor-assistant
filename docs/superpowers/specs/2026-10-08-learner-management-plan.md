# Learner management — phased plan

_Date: 2026-10-08 · Status: PLAN, approved by Tony in chat (phases and the two
defaults below) · Not yet implemented. Phase 1 starts after
`feature/lesson-ownership-revisions` ships._

Today the app can create and archive a learner (`PATCH /api/learners/[id]`
accepts only `archived`). There is no way to correct a learner's details. Tony
wants this strengthened over time, in phases that each ship on their own
(feature branch → independent review → Staging D1 migration → merge to
`staging` → Tony checks on his phone → `main` → Production Release workflow).

## ACTGDS and privacy (all phases)

- The ACTGDS contract (`lesson.upserted` v1, schema hash
  `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`) carries
  only `learner_id`, never the learner's name, address, phone, licence or DOB.
  Renaming or editing a learner therefore never breaks the ACTGDS link and
  never emits an event. No contract change in any phase.
- Emails and promotion consent stay in the ACTGDS CRM only; they are never
  stored in Instructor Assistant.
- No automatic matching of learners across the two systems.

## Phase 1 — basic edit (one small task)

| # | Decision |
|---|---|
| L1 | Edit `fullName`, `address`, `phone`, `dob`, `licenceNumber`, `licenceExpiry`, `eligibility`, `transmission`, `schoolWork`, `licenceStage`. Same validation as create. |
| L2 | Only the learner's own instructor (`learners.instructor_id`) may edit. Same principle as lessons (CoP 9.2). No verified Access identity (local dev/tests): behaviour as today. |
| L3 | Every successful edit stores a revision of the previous values in the same atomic `db.batch()` (table `learner_revisions`: id, learner_id, revision_no, edited_at, edited_by_instructor_id, snapshot_json). History is recorded only; no struck-through display yet. |
| L4 | `instructorId` (transfer) is NOT editable in this phase. |
| L5 | Migration `0008`: additive only (`learner_revisions` + index). Must be applied to Staging D1 BEFORE the code merges to `staging`. |
| L6 | Stay inside the D1 Free plan limits (50 queries per invocation, 100 bound parameters per statement); add a statement-count test. |

Tests: owner can edit; non-owner rejected with nothing written; atomic revision
(forced batch failure leaves neither); snapshot holds previous values; archived
learners; D1 budget; qa-browser at 375px (edit form, rename, History shows the
new name). First use: rename the learner imported on 2026-10-08.

## Phase 2 — learner data the assessment rules need (with the assessment-rules batch)

Designed together with the rules batch so the learners table changes once
(migration `0009`, nullable columns only). See `docs/ACT_ASSESSMENT_STANDARDS.md`.

- Learner licence issue date, old/new learner-licence type, hazard perception
  test passed, logged hours — for the Competency 23 eligibility reminder (R2).
- Learner licence validity reminder (R5), 36-hour gate reminders (R1),
  Competency 23 hours window (R3), copyable ADI Audit booking text (R4).
- All of these are reminders, never blockers of recording a lesson.

## Phase 3 — management features (decide per item after Phase 1 is in use)

- Missing-details marker for fields the PDF needs but are empty.
- Duplicate warning (same licence number).
- Transfer a learner to another instructor (touches lesson ownership, prior-
  instructor records and the ACTGDS link: needs its own design).
- Archive reason and restore history.

## Defaults confirmed in chat

- Only the learner's own instructor can edit.
- Learner revision history is stored but not displayed with strike-through in
  Phase 1.
