# TASK.md

_Last updated: 2026-10-11_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** R10a Competency 23 route reminders — **Completed** on `feature/route-r10a`
(from `origin/staging`; not pushed / not merged; no migration, 0 new D1 statements): unfamiliar
town-centre suggestion line on the Start Lesson panel (home district from the address), route
check group when 23 is Assessed (centre chips + 6 official ticks + "All met"), stored in location
+ one generated comment line, parsed back in History Edit; reminders only; nothing to ACTGDS
(contract hash unchanged). 3c T1 stays on `feature/transfer-t1` (migration `0011`, reviewed).

**Next Recommended Task:** independent code review of `feature/route-r10a`, then merge to
`staging` (§14). For T1: apply `0011` to Staging D1 BEFORE merging it. iPad layout waits for
Tony's real-iPad check.

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** R10a: none (no real-device-only behaviour). After T1 is on
Staging, one real-login transfer and transfer-back of a `QA …` learner (Access identity cannot be
simulated).

**Docs in flight:** `docs/operating-handbook` branch — Operating Handbook v2
(`docs/OPERATING_HANDBOOK.md`, approved by Tony 2026-10-12; §14 records his 10 decisions and
the follow-up tasks: docs/tasks memory scheme, cross-model review, notify caller spec). Docs only.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
