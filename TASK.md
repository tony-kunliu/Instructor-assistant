# TASK.md

_Last updated: 2026-10-08_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner management Phase 1 (edit learner details) —
**Completed** on `feature/learner-edit` (not merged). Plan:
`docs/superpowers/specs/2026-10-08-learner-management-plan.md` (L1-L6).
Typecheck, 384 tests, `cf:build`, qa-browser 178/178 and the local `0008` rehearsal
pass. Lesson ownership + revisions (`0007`) is on `staging`; re-check
Production's migration level before release.

**Next Recommended Task:** independent code review of `feature/learner-edit`,
then apply migration `0008` (additive) to Staging D1 FIRST with the
`Staging D1 Migrate` workflow (`ref` = `feature/learner-edit`, `confirm` =
`staging`), then merge to `staging` (AGENTS.md §14), verify on Staging, and
`staging` -> `main` -> Production Release. First use: rename the learner
imported on 2026-10-08.

**Waiting on Other Repo:** ACTGDS display fixes and first-event
confirmations (Issue #3). Nothing blocks this task (no contract change).

**Tony Manual Action Required:** NONE.
