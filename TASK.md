# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** 3c learner transfer **T1** — Completed and reviewed on `feature/transfer-t1`
(not pushed / not merged; staging merged in, incl. intake P1): migration `0011`
(`learner_transfer_events`), `POST /api/learners/[id]/transfer` and `/transfer/checked`, two-tap
Transfer panel, History line, receiver's CoP 9.1 h / 9.2 e reminder + "Checked". Nothing to ACTGDS.

**Next Recommended Task:** apply `0011` to Staging D1 (`Staging D1 Migrate`, `ref` = this branch)
BEFORE merging T1 to `staging`; then T2 (PDF "lessons by instructor" line, multi-transfer list,
Issue #3 info post) or R10a, on Tony's go. iPad layout waits for Tony's real-iPad check.

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** after T1 is on Staging, one real-login transfer and
transfer-back of a `QA …` learner (Access identity cannot be simulated). Optional: export one
Production PDF and confirm it is about 0.2 MB.

**Docs in flight:** `docs/operating-handbook` branch — Operating Handbook v2
(`docs/OPERATING_HANDBOOK.md`, §14 lists 10 decisions for Tony); docs only, no code.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
