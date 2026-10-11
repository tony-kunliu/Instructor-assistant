# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Completed (docs only): designs for 3c, transfer a learner
(`docs/superpowers/specs/2026-10-11-learner-transfer-design.md`), and R10,
Competency 23 route (`docs/superpowers/specs/2026-10-11-competency-23-route-design.md`),
on branch `docs/designs-3c-route` (not pushed). Staging and Production D1 are at `0010`.

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
