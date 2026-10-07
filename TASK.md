# TASK.md

_Last updated: 2026-10-07_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Post-merge verification and memory sync for P1a
(`feature/pdf-per-lesson-totals`, now in `staging`) — **Completed**.
Typecheck, 261/261 tests, build, and local 390px browser QA (96/96) PASS on
staging HEAD. Docs-only change; nothing deployed or migrated.

**Next Recommended Task:** Tony reviews one exported PDF on Staging. Then,
when Tony chooses, P1b (migration 0006 for the paper-records import:
nullable time/odometer, `record_source`, `signature_status`,
`integration_sync_paused`, batch import function; Tony-approved decisions:
gate not relaxed, V1 sync paused for imported learners, originals kept 5
years from the learner's last lesson, blank signatures allowed). P1b is a
major DB migration → Opus. NOT STARTED; Tony has deferred migrations for
now.

**Waiting on Other Repo:** NONE.

**Tony Manual Action Required:** look at one exported PDF on Staging
(`https://instructor-assistant.kunliu-work.workers.dev`, Access login).
Release A Sign-out phone check is DONE (PASS).

**Non-blocking backlog (not scheduled):** paper-records import P1b–P4;
promotion of P1a from `staging` to `main` needs Tony's explicit
authorization.
