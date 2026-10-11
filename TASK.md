# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner management Phase 3b (`feature/archive-reason`: archive
reason + restore history, migration `0010`) - built and tested locally; needs
independent review, then `0010` on Staging D1 BEFORE merging to `staging`.
Staging and Production D1 are at `0009`.

**Next Recommended Task:** review + Staging for 3b, then a design for 3c
(transfer a learner) before any code. See `docs/BACKLOG.md`.

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** NONE (optional: export one Production PDF
and confirm the size is small, about 0.2 MB).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
