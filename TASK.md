# TASK.md

_Last updated: 2026-10-08_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Lesson edit ownership + revision history (R6) —
**Completed** on `feature/lesson-ownership-revisions` (not merged). Spec:
`docs/superpowers/specs/2026-10-08-lesson-edit-ownership-and-revisions-design.md`.
Typecheck, 363 tests, `cf:build`, qa-browser 156/156 and the local `0007`
rehearsal pass. P1b is in Production (run 37796457888, Worker `96228a32`,
migration `0006`).

**Next Recommended Task:** independent code review, then merge to
`staging` (AGENTS.md §14), apply migration `0007` to Staging D1, verify on
Staging, `staging` -> `main`, and release via the Production Release
workflow (migration `0007` is additive).

**Waiting on Other Repo:** ACTGDS display fixes and first-event
confirmations (Issue #3). Nothing blocks this task (no contract change).

**Tony Manual Action Required:** NONE.
