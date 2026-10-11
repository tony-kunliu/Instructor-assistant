# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** `fix/progress-invalidation` (PR #54): History Edit milestone invalidation +
Completed banner consistency (actgds.com Issue #3, comment 6104913100) and the
Competency 23 route note in `docs/ACT_ASSESSMENT_STANDARDS.md` (R10). Reviewed twice;
next: staging merge, then Production release (no migration). Staging and Production D1 are at `0010`.
Designs for 3c (learner transfer) and R10 (route) are merged (docs).

**Next Recommended Task:** Tony decided both designs' questions on
2026-10-11 (all defaults; route Q1 changed to "familiar = home district").
On Tony's go: 3c T1 (migration 0011), then R10a (no migration). One small
route question remains (Weston Creek / Molonglo have no town centre; default:
no neighbour counts as home). See `docs/BACKLOG.md` "Planned order".

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** NONE (optional: answer the one remaining
route question; export one Production PDF and confirm it is about 0.2 MB).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
