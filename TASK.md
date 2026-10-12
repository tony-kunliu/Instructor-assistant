# TASK.md

_Last updated: 2026-10-12_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** R10a Competency 23 route reminders — **Completed** on `feature/route-r10a`
(pushed, not merged; no migration, 0 new D1 statements; two independent reviews, all findings
fixed; `origin/staging` merged in incl. intake P2 / migration `0012`): unfamiliar town-centre
suggestion line on the Start Lesson panel (home district from the structured suburb/state, else the
address text), route check group when 23 is Assessed (centre chips + 6 official ticks + "All met")
written into location + one generated comment line only on an explicit tap, parsed back in History
Edit; reminders only; nothing to ACTGDS (contract hash unchanged). Intake P2 and 3c T1 as below.

**Next Recommended Task:** merge `feature/route-r10a` to `staging` under §14 (no migration; `0012`
must already be on Staging D1 since P2 is merged). Then P3 (overseas/interstate licence) or T2
(apply `0011` to Staging D1 BEFORE merging T1), on Tony's go.

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** R10a: none (no real-device-only behaviour). After P2 is on Staging, on the real iPhone: tap the Address
field, confirm iOS "Scan Text" still appears in the callout, type `44 app` and check the list is
not hidden behind the keyboard (Access identity and iOS keyboard cannot be simulated). After T1 is
on Staging, one real-login transfer and transfer-back of a `QA …` learner.

**Docs in flight:** `docs/operating-handbook` branch — Operating Handbook v2
(`docs/OPERATING_HANDBOOK.md`, approved by Tony 2026-10-12; §14 records his 10 decisions and
the follow-up tasks: docs/tasks memory scheme, cross-model review, notify caller spec). Docs only.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
