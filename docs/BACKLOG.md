# Backlog

_Last updated: 2026-10-11. Not an authorization: every item still needs Tony's
go-ahead and ends with a stop (AGENTS.md §11). The longer-term two-repo
direction is in `docs/ECOSYSTEM_ROADMAP.md` (P1–P6)._

## Planned order (agreed with Tony 2026-10-10)

Direction, not an authorization: each item still needs Tony's go-ahead and
ends with a stop (AGENTS.md §11).

Near term (Instructor Assistant only, low risk):
1. DONE (Production 2026-10-11): learner management 3a (missing-PDF-details
   marker, duplicate licence warning incl. archived) and 3b (archive reason and
   restore history, migration 0010).
2. (done, see 1)
3. 3c: transfer a learner to another instructor. **Designed; questions
   decided (defaults accepted by Tony 2026-10-11); build T1 on Tony's go**:
   `docs/superpowers/specs/2026-10-11-learner-transfer-design.md` (migration
   0011, additive; no ACTGDS event).

Medium term (new features; confirm rules with Tony before building):
4. Competency 23 route suggestions and route check (R10). **Designed;
   questions decided 2026-10-11 (familiar = the learner's home district, from
   the address); build R10a on Tony's go**:
   `docs/superpowers/specs/2026-10-11-competency-23-route-design.md` (no
   migration; reminders only; nothing to ACTGDS; one small open question).
5. Remove-the-"A"-condition reminder after 12 months (R8, CoP 9.4).
6. Certificate number records (R9, CoP 9.3, 10 f).

Long term (ecosystem, coordinated with Work on actgds.com Issue #3):
7. P2 lesson notification emails: ACTGDS source is complete; activation is
   blocked on a secure unattended 5-minute schedule and the quiet-window
   check. No Instructor Assistant change needed.
8. P3 bookings into Today's Lessons (Cal.com).
9. P4 GPS tracking, then P5 drive intelligence. New storage = new
   infrastructure: needs Tony's separate approval; design first. Revisit when
   Tony is back in Australia with real learner data.
10. P6 driving journey across licence stages and both systems.

## Designed, waiting for a go

| Item | Where designed | Status |
|---|---|---|
| Learner edit, Phase 1 (name, address, phone, licence, ...) | `docs/superpowers/specs/2026-10-08-learner-management-plan.md` | **DONE** (in Production, migration 0008). |
| Learner data for assessment rules, Phase 2 (licence issue date, HPT, logged hours) | same plan; design: `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md` | **DONE** (in Production, migration 0009). |
| Assessment-rules reminders (never blockers): 36 h gates (R1), Competency 23 eligibility (R2) and hours window (R3), ADI Audit online booking link (R4), learner licence validity (R5) | `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md` | **DONE** (in Production 2026-10-10, run 38044255328): R1, R2, R3, R5 and the booking link. |
| Learner management, Phase 3a: missing-details marker, duplicate licence warning (reminders only, client-side) | learner management plan | **DONE** on `feature/learner-phase3a` (not merged). |
| Learner management, Phase 3b: archive reason and restore history | learner management plan (Phase 3) | **DONE** on `feature/archive-reason` (not merged): migration 0010 (`learner_archive_events`, additive), optional preset reason + note, History in the archived banner. Needs 0010 on Staging D1 before merging. |
| Learner management, Phase 3c: transfer a learner to another instructor (incl. the CoP 9.1 h / 9.2 e previous-records reminder, R12) | `docs/superpowers/specs/2026-10-11-learner-transfer-design.md` | Designed; Q1-Q6 decided (defaults, Tony 2026-10-11). Waiting for the go to build T1. |
| Competency 23 route suggestions and route check (R10) | `docs/superpowers/specs/2026-10-11-competency-23-route-design.md` | Designed; Q1-Q6 decided 2026-10-11 (Q1 changed: home district). Waiting for the go to build R10a. |
| Learner intake P1: "Competency 23 from" date + PDF Eligibility auto-fill (D17-D18) | `docs/superpowers/specs/2026-10-11-learner-intake-design.md` (branch `docs/learner-intake-design`) | **DONE** on `feature/intake-p1` (not merged; no migration). P2 address suggestions, P3 overseas/interstate licence, P4 scan: waiting for a go. |

## Minor follow-ups (bundle into the next feature)

- After a milestone has become invalid, every later edit of that lesson (even comment-only) repeats the 'No longer valid' message; report only when the status changed (lib/repo.ts recordedHere).

- Progress-invalidation fix (`fix/progress-invalidation`): before release,
  run `scripts/audit-progress.mjs` on a read-only Production export to list
  learners whose milestones change under the lesson-order rule. Reply to
  Work on Issue #3 once merged.

- Archiving an already-archived learner with a reason (two devices) returns 200 and drops the reason silently; consider a message.

- No message when a learner is archived while the edit form is open.
- The unmounted-key QA check for the PDF button is weak.
- Learner intake P1: "Missing for the PDF: Eligibility" still shows for an empty stored value even when the PDF will print the auto-filled `C23 from …`; consider counting a computable value as present.

## Not designed yet

- Remove the "A" condition in the first 12 months: Review 2 drive in a manual
  vehicle, with ADI Audit notified beforehand (R8, CoP 9.4).
- Certificate numbers: a field per issued certificate, issued in ascending
  number order, copies kept (R9, CoP 9.3, 10 f).
- Instructor phone use during a lesson ≤ 30 seconds: keep in-lesson actions to
  one or two taps; details after the lesson (R11, UX principle, CoP 5 f).
- Learners arriving from an ADI outside the school (paper import with
  prior-instructor rows): the same "check the previous records, tell ADI Audit"
  reminder as the 3c design D7 could be shown after import (R12, CoP 9.1 h /
  9.2 e). Not designed; a note until Tony asks.
- Emails and promotion consent: stay in the ACTGDS CRM only, never stored in
  Instructor Assistant. A consent design and a registration form are ACTGDS work
  and are deferred.
- Paper import for further learners: the tooling is live in Production
  (migration 0006); waiting for paper records from Tony.
- A read-only check on Production for lessons recorded before Access identity
  existed (their owner falls back to the learner's instructor). Tony believes
  there are none.
- Every October: add the next year's ACT public holidays to
  `lib/act-public-holidays.ts` (procedure in its header) and append the year to
  `COVERED_YEARS`; until then dates outside 2026-2027 show "not loaded; check
  manually". Cross-check the 2026-2027 table against the ACT Government
  public-holidays page, which returned HTTP 403 to the build environment.
- History markers for past reviews done inside 36 h (rules-reminders spec, later).

## Ecosystem phases (see the roadmap)

- P1 Student Account: ACTGDS side ("My Driving"); is live in Production.
- P2 Lesson notification emails, P3 Cal.com booking into Today's Lessons, P4 GPS
  tracking, P5 Drive intelligence, P6 Driving journey: not started.
