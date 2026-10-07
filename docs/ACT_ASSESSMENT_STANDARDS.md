# ACT Provisional Car Licence Assessment Standards — development guide

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

## Rules not yet (fully) reflected in the app

| # | Rule (instrument) | App today | Status |
|---|---|---|---|
| S1 | Competencies **19 (Overtaking)** and **22 (Vulnerable road users)** "may be assessed out of sequence". | 18–22 are all locked until Review 1-17 is achieved. | Candidate fix — Tony to decide |
| S2 | Review 2 (1-22) "shall be conducted not less than **36 hours** after competencies 1 to 17 have been completed". | Not enforced. | Candidate gate — interpretation to confirm |
| S3 | Competency 23 only for a student aged at least **16 years 350 days** who has held a learner licence for at least **5½ months**; if competent under those conditions, note the P-licence eligibility date in the CBT&A Certificate's restrictions section. | Not enforced; learner-licence issue date is not stored. | Candidate warning — Tony to decide |
| S4 | Students must hold a **current ACT learner licence** before CBT&A instruction. | Licence expiry stored, not checked. | Candidate warning — Tony to decide |
| S5 | Competency 19 may be performed over **2 lessons**. | One lesson per assessment. | Note only |
| S6 | Competency 23 must be in one RTA-accepted **town centre** (Civic, Gungahlin, Belconnen, Woden, Tuggeranong, Fyshwick, Manuka+Kingston) incl. ≥1 stop, ≥1 give way, 2 lights, 2 pedestrian crossings, ≥5 right + 5 left turns. | Location is free text. | Possible location suggestions |
| S7 | ACT ADIs may not teach/assess in NSW without a NSW qualification. | — | Note only |

## Transfer learners (Tony's practice, Code of Practice)

When a learner transfers from another ADI, the new ADI re-reviews the
competencies the previous ADI already stamped ("Reviewed 1-22"). The app
records the previous ADI's stamped competencies as prior-instructor
records (P1b spec §12) and the re-review as a lesson comment, not as new
"taught" competencies.
