# Backlog

_Last updated: 2026-10-08. Not an authorization: every item still needs Tony's
go-ahead and ends with a stop (AGENTS.md §11). The longer-term two-repo
direction is in `docs/ECOSYSTEM_ROADMAP.md` (P1–P6)._

## Designed, waiting for a go

| Item | Where designed | Notes |
|---|---|---|
| Learner edit, Phase 1 (name, address, phone, licence, ...) | `docs/superpowers/specs/2026-10-08-learner-management-plan.md` | In progress (migration 0008). |
| Learner data for assessment rules, Phase 2 (licence issue date, old/new licence, HPT, logged hours) | same plan | Designed together with the rules batch (migration 0009). Tony paused it on 2026-10-08. |
| Assessment-rules reminders (never blockers): 36 h gates (R1), Competency 23 eligibility (R2) and hours window (R3), ADI Audit booking text (R4), learner licence validity (R5) | `docs/ACT_ASSESSMENT_STANDARDS.md` | Paused by Tony on 2026-10-08. |
| Learner management, Phase 3 (missing-details marker, duplicate licence warning, transfer a learner to another instructor, archive reason) | learner management plan | Decide per item after Phase 1 is in use. |

## Not designed yet

- Remove the "A" condition in the first 12 months: Review 2 drive in a manual
  vehicle, with ADI Audit notified beforehand (R8, CoP 9.4).
- Certificate numbers: a field per issued certificate, issued in ascending
  number order, copies kept (R9, CoP 9.3, 10 f).
- Competency 23 route: town-centre suggestions and a route check (one accepted
  town centre; stop/give-way/lights/crossings/turn counts) (R10).
- Instructor phone use during a lesson ≤ 30 seconds: keep in-lesson actions to
  one or two taps; details after the lesson (R11, UX principle).
- Transfer learners: tell ADI Audit when a previous instructor's record is
  incorrect, false, misleading or incomplete (R12, a note, not a feature).
- Emails and promotion consent: stay in the ACTGDS CRM only, never stored in
  Instructor Assistant. A consent design and a registration form are ACTGDS work
  and are deferred.
- Paper import for further learners: the tooling is live in Production
  (migration 0006); no paper records are waiting (Tony, 2026-10-08). Learner 01
  was imported on 2026-10-08.
- A read-only check on Production for lessons recorded before Access identity
  existed (their owner falls back to the learner's instructor). Tony believes
  there are none.

## Ecosystem phases (see the roadmap)

- P1 Student Account: in progress on the ACTGDS side ("My Driving").
- P2 Lesson notification emails, P3 Cal.com booking into Today's Lessons, P4 GPS
  tracking, P5 Drive intelligence, P6 Driving journey: not started.
