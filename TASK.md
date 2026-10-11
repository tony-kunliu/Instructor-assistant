# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Completed (docs only): designs for 3c, transfer a learner
(`docs/superpowers/specs/2026-10-11-learner-transfer-design.md`), and R10,
Competency 23 route (`docs/superpowers/specs/2026-10-11-competency-23-route-design.md`),
on branch `docs/designs-3c-route` (not pushed). Staging and Production D1 are at `0010`.

**Next Recommended Task:** Tony answers Q1-Q6 of each design (or "all
defaults"); then 3c task T1 (migration 0011), then R10a (no migration). See
`docs/BACKLOG.md` "Planned order".

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** decide only: read both designs and answer
their Q1-Q6 (or reply "all defaults"). Optional: export one Production PDF and
confirm the size is small, about 0.2 MB.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
