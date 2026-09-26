# TASK.md

No active development task.

**Completed this session (CBT&A V3):** history lesson editing (every field
editable except lesson number/duration/distance/cumulative totals, which
always recalculate; cascading recalculation to subsequent lessons;
carry-forward odometer consistency checks; signature invalidation on any
content change, enforced server-side; `lessons.updated_at` tracking) plus a
correction to 23 Final Drive gating (now correctly Locked until Competency
1-22 + Review 1-17 + Review 1-22 are all Achieved) and automatic rollback of
Review 1-17 / Review 1-22 / Final Drive 23 / CBT&A Completed if an edit
invalidates their prerequisites, with a clear UI warning. Built on
`feature/history-edit-and-finaldrive-gating` from `staging`, merged back
into `staging`, Cloudflare Staging redeployed with migration 0003 applied.
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
  native iOS/Android apps. (Lesson edits are timestamped via `updated_at`
  but not attributed to a specific logged-in person — no login system was
  built, per instruction.)

**Follow-up for Tony (not done, needs his action):**

- Enable Cloudflare Zero Trust Access in the dashboard (one-time, manual —
  cannot be done via API token) so Basic Auth on Staging can be replaced
  with a proper Access application.
- Confirm the official CBT&A competency full names/content once available
  (currently only official numbering 1-22 / Review 1-17 / Review 1-22 / 23
  Final Drive is used — nothing invented, per AGENTS.md).
- Decide when to authorize merging `staging` into `main`.

等待 Tony 指定下一任务。
