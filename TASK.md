# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Partial — `fix/progress-invalidation` (local commit, not
pushed): History Edit milestone invalidation + Completed banner consistency
(actgds.com Issue #3, comment 6104913100) and the Competency 23 route note in
`docs/ACT_ASSESSMENT_STANDARDS.md` (R10). Needs review, push and staging merge.

**Next Recommended Task:** a design for 3c (transfer a learner to another
instructor) before any code; then Competency 23 route suggestions. See
`docs/BACKLOG.md` "Planned order".

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** NONE (optional: export one Production PDF
and confirm the size is small, about 0.2 MB).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
