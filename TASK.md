# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Release A (application Production release) — **Completed**
(automated). Production Worker `b76eeb2c-163d-4b32-a49d-042d32063e00`
(previous `a5708df9-5dcf-4c10-b26b-212fb4bf9a3f`), D1 still `0004`,
Integration V1 OFF.

**Next Recommended Task:** Tony/Anna real Access login smoke test; then
decide on Release B (Integration Production enablement) — not authorized
or started. P3-B not started.

**Waiting on Other Repo:** NONE.

**Tony Manual Action Required:** real Access login on Production (Tony +
Anna), confirm My Learners loads.

**Non-blocking backlog (not scheduled):**
- UX: Finish odometer can be typed before Start Lesson is tapped (Tony,
  2026-09-29). Consider showing/enabling it only once the lesson is
  running or ended.
- A location/comments-only History Edit still emits a propagated
  Integration event to already-exported downstream lessons (correct data,
  no private content).
- Deployment is not agent-observable (Workers Builds status unreadable,
  Staging behind Access). Smallest fix, needs Tony once: a read-only
  Cloudflare token as a GitHub Actions secret so CI can verify the deployed
  version, or permission for the agent to open a PR so check runs become
  readable.

**Production:** UNCHANGED.
