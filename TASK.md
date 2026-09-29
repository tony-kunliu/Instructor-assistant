# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner List Usability & Lifecycle MVP — **Partial**.
Implemented and verified on `feature/learner-list-lifecycle`: My learners
default, All / Archived views, name search, Archive / Restore (existing
`archived_at`, no migration), Final Drive 23 archive suggestion (never
automatic). typecheck + 124/124 tests + build PASS; local real-browser
mobile QA (390px) 34/34 PASS. **Not done:** Staging deploy and
real-Access Staging QA — this session had no Cloudflare credentials.

**Next Recommended Task:** Tony reviews the branch; with authorization,
merge into `staging`, deploy Staging, and run a short real-Access QA as
both Tony and Anna using a synthetic QA learner (archive → restore).

**Waiting on Other Repo:** NONE for this feature (no Integration V1 /
ACTGDS change). Integration V1 follow-up (Receiver confirming the retry
event) remains open in `tony-kunliu/actgds.com` Issue #3.

**Tony Manual Action Required:** Review and authorize the `staging` merge,
and run (or provide credentials for) the Staging deploy.

**Production:** UNCHANGED.
