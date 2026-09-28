# TASK.md

_Last updated: 2026-09-28_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Coordinated non-Production Integration QA (Sender Phase 1)
— Partial. Staging migration/secret-binding-check/webhook-config/enable/
deploy all done and verified. Blocked before the first signed delivery.

**Next Recommended Task:** Create one isolated synthetic QA learner/lesson
on Staging (via a real Access-authenticated session), confirm the resulting
outbox delivery status, then hand off learner_id/event_id to ACTGDS
Receiver for mapping/replay. See `tony-kunliu/actgds.com` Issue #3.

**Waiting on Other Repo:** ACTGDS Receiver to map/replay once the first
event is delivered.

**Tony Manual Action Required:** Create the synthetic QA learner/lesson on
Staging yourself (Cloudflare Access requires your/Anna's real identity —
no agent-side bypass exists), or provide a Cloudflare Access Service Token
if you want this done without your interactive session.

**Production:** UNCHANGED.
