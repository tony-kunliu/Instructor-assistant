# Backlog

_Last updated: 2026-10-10. Not an authorization: every item still needs Tony's
go-ahead and ends with a stop (AGENTS.md §11). The longer-term two-repo
direction is in `docs/ECOSYSTEM_ROADMAP.md` (P1–P6)._

## Designed, waiting for a go

| Item | Where designed | Status |
|---|---|---|
| Learner edit, Phase 1 (name, address, phone, licence, ...) | `docs/superpowers/specs/2026-10-08-learner-management-plan.md` | **DONE** (in Production, migration 0008). |
| Learner data for assessment rules, Phase 2 (licence issue date, HPT, logged hours) | same plan; design: `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md` | **DONE** (in Production, migration 0009). |
| Assessment-rules reminders (never blockers): 36 h gates (R1), Competency 23 eligibility (R2) and hours window (R3), ADI Audit online booking link (R4), learner licence validity (R5) | `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md` | **DONE** (in Production 2026-10-10, run 38044255328): R1, R2, R3, R5 and the booking link. |
| Learner management, Phase 3 (missing-details marker, duplicate licence warning, transfer a learner to another instructor, archive reason) | learner management plan | Undecided; decide per item. |

## Minor follow-ups (bundle into the next feature)

- No message when a learner is archived while the edit form is open.
- The unmounted-key QA check for the PDF button is weak.

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
