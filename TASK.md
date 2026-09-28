# TASK.md

_Last updated: 2026-09-28_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Coordinated non-Production Integration QA (Sender Phase 3,
UPDATE only) — Complete. Tony edited the existing synthetic QA lesson via
the real Staging app; the resulting update event
(`event_id b74bc541-9dd5-4262-a4a1-b293f1d9c22e`) delivered on the first
attempt (Staging outbox: `delivered`, no error). Per Tony's explicit scope
narrowing, Sender did not attempt any direct `integration_outbox` mutation
this round (a prior attempt was denied by an automated safety classifier;
Tony instructed not to retry or request that permission). Duplicate/stale
verification moved to ACTGDS Receiver's own isolated protocol QA
mechanism. Evidence posted to `tony-kunliu/actgds.com` Issue #3.

**Next Recommended Task:** ACTGDS Receiver independently confirms the
mirror reflects the updated snapshot (`duration_minutes 64`,
`distance_km 20`), confirms the exact HTTP result for the update event,
then runs its own duplicate/stale protocol QA. Sender takes no further
action until that handoff or Tony's next authorization.

**Waiting on Other Repo:** ACTGDS Receiver — confirm mirror update,
confirm HTTP result, run duplicate/stale QA.

**Tony Manual Action Required:** NONE right now — waiting on ACTGDS
Receiver's next handshake in Issue #3.

**Production:** UNCHANGED.
