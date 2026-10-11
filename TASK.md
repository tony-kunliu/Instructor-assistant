# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Build the decided designs on Staging: intake P1 (done, released with this PR), 3c transfer T1
(migration 0011), then R10a (see `docs/BACKLOG.md` "Planned order"). Production is at D1 `0010`.

**Next Recommended Task:** Apply 0011 to Staging D1 BEFORE merging T1 to staging. iPad layout waits for Tony's real-iPad check.

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** NONE (optional: export one Production PDF
and confirm it is about 0.2 MB).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
