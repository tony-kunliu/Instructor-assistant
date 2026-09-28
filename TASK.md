# TASK.md

_Last updated: 2026-09-28_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Coordinated non-Production Integration QA (Sender Phase 1)
— Complete. Migration/secret-check/webhook-config/enable/deploy done;
synthetic learner created by Tony; first signed `lesson.upserted` event
delivered (Staging outbox: `delivered`, first attempt, no error). Per
Tony's instruction, Sender stopped here after posting the evidence to
`tony-kunliu/actgds.com` Issue #3.

**Next Recommended Task:** ACTGDS Receiver confirms the exact HTTP result
for `event_id 330cf15f-2c6c-499a-adbc-83654353cbc5` (expected `202
pending_link`), creates/uses its isolated QA student, then performs
explicit mapping and replay. Sender takes no further action until that
handoff or Tony's next authorization.

**Waiting on Other Repo:** ACTGDS Receiver — confirm delivery result,
post its QA student_id, map, and replay.

**Tony Manual Action Required:** NONE right now — waiting on ACTGDS
Receiver's next handshake in Issue #3.

**Production:** UNCHANGED.
