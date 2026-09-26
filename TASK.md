# TASK.md

No active development task.

**Completed this session:** CBT&A V2 structured competency selection
(Taught / Assessed / Achieved via mobile number chips, Review 1-17 / Review
1-22 / Final Drive 23 unlock chain, full competency-event history). Built on
`feature/cbta-competency-selection` from `staging`, merged back into
`staging`, Cloudflare Staging redeployed with the new D1 migration applied.
Not merged into `main` (needs Tony's authorization) and Production was not
touched. See STATUS.md for full detail.

**Explicitly out of scope this round (per instruction, roadmap only):**

- PDF export (future: fill the official ACT CBT&A Checklist PDF format from
  lesson records).
- GPS / Drive Tracking V1 (Start Lesson → GPS tracking → End Lesson →
  actual GPS distance, duration, moving/stopped time, route).
- Drive Intelligence V2 (roundabout / intersection / traffic-light / stop /
  give-way / speed-zone / motorway analysis from GPS data).
- Instructor / Learner / Parent login, booking, CRM, AI, voice input,
  native iOS/Android apps.

**Follow-up for Tony (not done, needs his action):**

- Enable Cloudflare Zero Trust Access in the dashboard (one-time, manual —
  cannot be done via API token) so Basic Auth on Staging can be replaced
  with a proper Access application.
- Confirm the official CBT&A competency full names/content once available
  (currently only official numbering 1-22 / Review 1-17 / Review 1-22 / 23
  Final Drive is used — nothing invented, per AGENTS.md).
- Confirm the official unlock rule for 23 Final Drive, if any exists beyond
  Assessed + Achieved (none was added this round, per instruction).
- Decide when to authorize merging `staging` into `main`.

等待 Tony 指定下一任务。
