# TASK.md

## Current task

**CBT&A Lesson Checklist MVP** (status: done, awaiting review) — branch `feature/cbta-checklist`

Allow a driving instructor to complete the ACT CBT&A Lesson Checklist on an
iPhone in roughly 30–60 seconds after each lesson.

Flow: Select learner → Start Lesson → conduct lesson → End Lesson → complete
checklist → ADI signature → learner signature → Save.

### Acceptance

- Learner: name, address, phone, DOB, licence number, licence expiry,
  eligibility, manual/auto, school/work, instructor.
- Lesson: date, lesson number, start/finish time, start/finish odometer,
  duration, km, cumulative hours/km, taught, competencies assessed, achieved,
  location, comments, ADI signature, learner signature.
- Auto-calculated: lesson number, duration, km, cumulative hours/km; previous
  finish odometer carried forward as next start odometer.
- `npm run build` and `npm test` pass.

### Out of scope

Learner/parent login, booking / Cal.com, AI summaries, voice input, PDF export,
competency shortcut buttons, Driving Journey, route recommendations, HPT,
theory test, final drive automation, push notifications, native apps.
