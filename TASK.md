# TASK.md

_Last updated: 2026-10-01_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** P1a — CBT&A PDF "Total hrs / Total kms" cells now show
each lesson's OWN totals (matches the paper form); a running-total line
(`Cumulative to lesson #N: X h / Y km`) is printed under the table on every
page. Branch `feature/pdf-per-lesson-totals` — **Completed** (build + 261
tests + Memory Guard PASS; visual render checked). Not merged to staging.

**Next Recommended Task:** Tony reviews the PDF export on staging after
authorizing the merge. Then P1b (migration 0006: nullable time/odometer,
`record_source`, `signature_status`, `integration_sync_paused`, batch
import function) per the paper-records import design (Tony-approved
decisions: gate not relaxed; V1 sync paused for imported learners; originals
kept 5 years from the learner's last lesson; blank signatures allowed).
P1b is a major DB migration → Opus. NOT STARTED.

**Waiting on Other Repo:** NONE.

**Tony Manual Action Required:** authorize merge of this branch into
`staging` (then glance at one exported PDF); Sign-out real-phone check from
Release A is still outstanding.

**Non-blocking backlog (not scheduled):** paper-records import P1b–P4.
