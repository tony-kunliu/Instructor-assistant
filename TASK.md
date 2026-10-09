# TASK.md

_Last updated: 2026-10-10_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Documentation/status refresh (STATUS, TASK, BACKLOG) —
**Completed**. No code task is open. Production and Staging D1 are both at
`0008`; everything built so far is released to Production.

**Next Recommended Task:** Tony records real lessons in Production, then
decides what to build next from `docs/BACKLOG.md`. Wait for Website Work's
My Driving Production release (needs Tony's separate authorization).

**Waiting on Other Repo:** ACTGDS: My Driving Production release (Website
Work) and Tony's display polish list for Work. Nothing blocks this repo.

**Tony Manual Action Required:** NONE (optional: export one Production PDF
and confirm the size is small, about 0.2 MB).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
