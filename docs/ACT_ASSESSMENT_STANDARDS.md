# ACT CBT&A rules — development guide (Assessment Standards + Code of Practice)

Source (authoritative, public): **Road Transport (Driver Licensing)
Provisional Car Licence Assessment Standards (Accredited Driving Instructor)
Approval 2016 (No 1)**, Notifiable Instrument **NI2016-463**, made under
s 119 of the Road Transport (Driver Licensing) Regulation 2000; commenced
28 August 2016; applies to learner licences issued on or after that date
(NI2010-291 applies to earlier ones). Mandatory for ADIs under clause 7.15
of the Code of Practice for Accredited Driving Instructors. Full text:
legislation.act.gov.au (NI2016-463). Supplied by Tony on 2026-10-08 as
development guidance.

This file records only what the app must respect. The instrument wins
over this summary; if they disagree, fix this file.

## Structure the app already models

- Competencies 1–22; Review 1 (= Review 1-17) after 1–17; Review 2
  (= Review 1-22) after 1–22; Competency 23 (= Final Drive 23) last.
- Each competency is assessed "during a single lesson unaided by the
  instructor" with a compliance level (90% / 100% / max 4 attempts). The
  app records the instructor's result only (Achieved / Not achieved); it
  does not score sub-items.

## Second source: Code of Practice (DI2016-237)

**Road Transport (Driver Licensing) Driving Instruction and Assessment Code
of Practice 2016 (No 1)**, Disallowable Instrument **DI2016-237**, s 118 of
the Regulation, commenced 28 August 2016. Supplied by Tony on 2026-10-08.
Where the two instruments differ, both are listed; Tony decides.

## Rules not yet (fully) reflected in the app

| # | Rule | Source | App today | Status |
|---|---|---|---|---|
| S1 | Competency **19** may be assessed out of sequence (before Review 1). The Standards also say **22** may; the CoP names only 19. | NI 19/22; CoP 7.17 | 18–22 locked until Review 1-17 | Fix 19; 22 → Tony |
| S2 | Review 1 (1-17) **≥ 36 hours after 1–17 achieved**; Review 2 (1-22) **≥ 36 hours after 18–22 achieved** (Standards: Review 2 ≥ 36 h after 1–17). | CoP 7.16; NI Review 2 | Not enforced | Candidate gate |
| S3 | Competency 23 only if learner licence held **≥ 5½ months** (interstate learner licence counts) **and** age **≥ 16 y 350 d**; a **full overseas licence** holder need not wait. If deemed competent, note the P-licence eligibility date (17 y and learner ≥ 6 months, or overseas licence) in the Certificate's restrictions section. | CoP 7.18; NI 23 | Not enforced; learner-licence issue date not stored | Candidate warning |
| S4 | Student must hold a **valid ACT learner licence** at every lesson; identity verified before any assessment. | CoP 7.2; NI note | Expiry stored, not checked | Candidate warning |
| S5 | Competency 23 only **Mon–Thu 07:00–19:00, Fri 07:00–21:00, Sat 07:00–19:00**; never Sundays or ACT public holidays. | CoP 7.19 | Not checked | Candidate warning |
| S6 | Competency 23 booking advice to ADI Audit **≥ 1 full working day before**, with name, ACT learner licence no., date, time, pick-up and drop-off addresses (+ interstate/overseas licence details). | CoP 7.18 | — | Candidate helper (copyable text) |
| S7 | **Auto → manual upgrade**: competencies 2–17, then straight to the Competency 23 review; booking must say it is a manual upgrade. | CoP 7.25 | Not modelled | Candidate path |
| S8 | Instructor must not use a phone for more than **30 seconds** during a lesson. | CoP 5.2 | — | UX principle: in-lesson actions must be one or two taps; detail entry after the lesson |
| S9 | Lesson Checklist kept in the vehicle during lessons and records kept **≥ 12 months**; Certificate duplicates kept ≥ 6 months; certificates issued in ascending number order. | CoP 8.4, 7.6–7.12 | PDF export; paper originals 5 years | Possible certificate-number field |
| S10 | Competency 19 may be performed over 2 lessons; Competency 23 in one RTA-accepted town centre with minimum manoeuvres. | NI 19, 23 | One lesson; free-text location | Note / location suggestions |
| S11 | Inform ADI Audit if a transfer student's logbook is filled out incorrectly. | CoP 7.24 | — | Note for transfers |

## Transfer learners (Tony's practice, Code of Practice)

When a learner transfers from another ADI, the new ADI re-reviews the
competencies the previous ADI already stamped ("Reviewed 1-22"). The app
records the previous ADI's stamped competencies as prior-instructor
records (P1b spec §12) and the re-review as a lesson comment, not as new
"taught" competencies.
