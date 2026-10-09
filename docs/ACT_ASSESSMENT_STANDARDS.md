# ACT CBT&A rules — development guide

The app must respect these two **current** ACT instruments. Both commenced
7 November 2020 and were verified current on legislation.act.gov.au on
2026-10-08:

- **Assessment Standards** — *Road Transport (Driver Licensing) Issue of a
  Provisional Car Licence by an Accredited Driving Instructor Assessment
  Standards 2020*, **NI2020-703** (s 119). It revokes NI2016-463 and
  NI2010-291.
- **Code of Practice** — *Road Transport (Driver Licensing) Driving
  Instructor Code of Practice 2020 (No 1)*, **DI2020-294** (s 118). It
  revokes DI2016-237.

Superseded and **not** to be used: NI2016-463 and DI2016-237. Tony
originally supplied these copies, and they differ on several rules, e.g.
Competency 22 and rear-view cameras.

The instruments win over this summary. If they disagree, fix this file.

## Already modelled

- Competencies 1–22, Review 1 (= Review 1-17), Review 2 (= Review 1-22),
  Competency 23 (= Final Drive 23). The app records the instructor's
  Achieved / Not achieved result; it does not score sub-items.
- NI2020-703 preamble:
  - "Competencies 1 – 17 may be assessed out of sequence but must be
    assessed as competent prior to Review 1 being undertaken."
  - "Competencies 19 (overtaking) and 22 (vulnerable road users) may be
    assessed at any time prior to Review 1 or Review 2."
  - "All 22 competencies must be assessed as competent prior to Review 2
    and competency 23 being undertaken."
  - In the app, only 18, 20 and 21 are gated behind Review 1.

## Rules not yet (fully) reflected in the app

| # | Rule | Source | App today | Status |
|---|---|---|---|---|
| R1 | Review 1 **≥ 36 hours** after 1–17 completed; Review 2 **≥ 36 hours** after 1–22 completed. | NI2020-703 Review 1 / Review 2 | Reminder only, never blocks | Reminder (display only), implemented on branch `feature/rules-reminders-t1` |
| R2 | Competency 23 eligibility (see the breakdown below). | NI2020-703 Competency 23; CoP 9.2 k–l | Not enforced; licence issue date, HPT and hours not stored | Planned (warning) |
| R3 | Competency 23 only Mon–Thu & Sat 07:00–19:00 and Fri 07:00–21:00; never on Sundays or ACT public holidays. | NI2020-703 Competency 23 | Reminder only, never blocks | Reminder (display only), implemented on branch `feature/rules-reminders-t1` |
| R4 | Competency 23 booking (see the breakdown below). | CoP 9.2 m–p | — | Planned: **link only, booking is online** (ADI Audit online form; Tony 2026-10-10) |
| R5 | Student must hold a **current ACT learner licence** before CBT&A training/assessment. | NI2020-703 note; CoP 9 a, c | Reminder only, never blocks | Reminder (display only), implemented on branch `feature/rules-reminders-t1` |
| R6 | **Corrections**: strike out and initial. Never change entries **made by other instructors**. Never record something not assessed at the time of entry. | CoP 9.1 f–g, 9.2 c–d | History Edit overwrites; any instructor can edit any lesson | **Implemented on branch** `feature/lesson-ownership-revisions` (approved by Tony 2026-10-08): own lessons only + revision history; migration 0007 pending |
| R7 | Rear-view cameras **permitted**; no automated/assisted reverse parking. Instructors must teach safe use of in-car technology. | NI2020-703 Comp 23 NB; CoP | — | Note |
| R8 | Removing the 'A' condition in the first 12 months: Review 2 drive in a manual vehicle, with ADI Audit notified beforehand. | CoP 9.4 | Not modelled | Backlog |
| R9 | Record keeping (see the breakdown below). | CoP 9.3, 10 f | PDF export; paper originals kept 5 years | Possible certificate-number field |
| R10 | Competency 23 route (see the breakdown below). | NI2020-703 Comp 23 | Free-text location | Possible location suggestions |
| R11 | Instructor phone use during a lesson ≤ 30 seconds. | CoP | — | **UX principle**: in-lesson actions are one or two taps; details after the lesson |
| R12 | Inform ADI Audit if a transfer student's record from another instructor is incorrect, false, misleading or incomplete. | CoP 9.2 e | — | Note for transfers |

**R2 — Competency 23 eligibility**
- **Old learner licence** (in force before 1 Jan 2020 and not renewed
  since): age ≥ 16 years 350 days, and licence held ≥ 5½ months.
- **New learner licence, under 25 when issued**: 100 logged hours, licence
  held ≥ 12 months, hazard perception test (HPT) passed, age ≥ 17.
- **New learner licence, 25 or older when issued**: 50 logged hours,
  licence held ≥ 6 months, HPT passed.

**R4 — Competency 23 booking with ADI Audit**
- Book at least **1 clear business day** before, in writing on the ADI
  Audit booking form.
- Include: student name; ACT learner licence number (or licence details);
  date and time; full pick-up and drop-off addresses.
- Report cancellations and changes within 2 hours where possible.
- Notify ADI Audit if more than 5 minutes late.

**R6 — Corrections (derived values)**
- Cumulative totals on later lessons are derived values: editing a lesson
  recomputes them without a revision for those lessons. They are not an
  instructor's entry under CoP 9.2; only the edited lesson gets a revision.

**R9 — Record keeping**
- Keep the lesson checklist in the vehicle; keep records ≥ 12 months.
- Keep certificate copies ≥ 6 months.
- Issue certificates in ascending number order.

**R10 — Competency 23 route**
- One accepted town centre: Civic, Gungahlin, Belconnen, Woden,
  Tuggeranong, Fyshwick, or Manuka+Kingston.
- At least 1 stop sign, 1 give way, 2 traffic lights, 2 pedestrian
  crossings, and 5 right + 5 left turns.

Student complaints channel: Access Canberra ADI Audit section,
Audit.Bookings@act.gov.au (CoP 11 b). Relevant to the ACTGDS website.

## Transfer learners (Tony's practice)

When a learner transfers from another ADI, the new ADI re-reviews the
competencies the previous ADI already stamped ("Reviewed 1-22").
- The app records the previous ADI's stamped competencies as
  prior-instructor records (P1b spec §12). These cannot be edited (CoP:
  never change other instructors' entries).
- The re-review is recorded as a lesson comment, not as new "taught"
  competencies.
