# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** 3c learner transfer **T1** — Completed on `feature/transfer-t1`
(not pushed / not merged): migration `0011` (`learner_transfer_events`), `POST
/api/learners/[id]/transfer` and `/transfer/checked`, two-tap Transfer panel, History
line, receiver's CoP 9.1 h / 9.2 e reminder + "Checked". Nothing enqueued to ACTGDS.

**Next Recommended Task:** review T1, then apply `0011` to Staging D1 (`Staging D1
Migrate`, `ref` = this branch) BEFORE merging it to `staging`; then T2 (PDF
"lessons by instructor" line, multi-transfer list, Issue #3 info post) or R10a,
on Tony's go. See `docs/BACKLOG.md` "Planned order".

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** after Staging deploy, one real-login transfer
and transfer-back of a `QA …` learner (Access identity cannot be simulated).
Optional: the remaining route question.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
