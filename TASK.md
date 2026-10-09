# TASK.md

_Last updated: 2026-10-10_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Assessment-rules reminders T2 (`feature/rules-reminders-t2`,
migration 0009, five learner fields, R2) — **Completed on the branch**
(on top of T1); typecheck, tests, qa-browser and the Workers Builds
simulation pass. Not merged; needs independent review.
Production and Staging D1 are both at `0008`.

**Next Recommended Task:** Independent review of T2, then apply 0009 to Staging
D1 (Staging D1 Migrate, ref = the branch, confirm = staging), merge T1 and T2
to `staging` and Tony's phone check. The yearly ACT holiday update is in `docs/BACKLOG.md`.

**Waiting on Other Repo:** ACTGDS: My Driving Production release (Website
Work) and Tony's display polish list for Work. Nothing blocks this repo.

**Tony Manual Action Required:** NONE (optional: export one Production PDF
and confirm the size is small, about 0.2 MB).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
