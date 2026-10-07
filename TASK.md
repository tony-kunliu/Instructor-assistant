# TASK.md

_Last updated: 2026-10-07_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** P1a (`feature/pdf-per-lesson-totals`) promoted to `main`
and memory synced — **Completed**. Typecheck, 261/261 tests, build, local
390px browser QA (96/96) and CI PASS. Nothing deployed or migrated.

**Next Recommended Task:** P1a is merged to `main` (Tony authorized the
main merge only; Tony's Staging PDF check: OK). Production deploy of P1a
needs Tony's separate explicit authorization. When Tony chooses, P1b
(migration 0006 for the paper-records import: nullable time/odometer, `record_source`, `signature_status`,
`integration_sync_paused`, batch import function; Tony-approved decisions:
gate not relaxed, V1 sync paused for imported learners, originals kept 5
years from the learner's last lesson, blank signatures allowed). P1b is a
major DB migration → Opus. NOT STARTED; Tony has deferred migrations for
now.

**Waiting on Other Repo:** NONE.

**Tony Manual Action Required:** none now. Release A Sign-out phone check
and the Staging PDF check are DONE (PASS). Decide whether to authorize a
Production deploy of P1a.

**Non-blocking backlog (not scheduled):** paper-records import P1b–P4.
