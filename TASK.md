# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Release A (application Production release) — **Partial**.
main = staging `9fabe2c` (fast-forward, Tony-authorized); Production deploy
not done: the agent has no Cloudflare credential. Integration V1 stays OFF,
no migration for Release A.

**Next Recommended Task:** Deploy Release A: give the session a Cloudflare
API token (environment settings), then `opennextjs-cloudflare build` +
`wrangler deploy --env production` from main `9fabe2c`; record the new
version; Tony + Anna real Access login, confirm My Learners. Then STOP.

**Waiting on Other Repo:** NONE (Release B / P3 not authorized).

**Tony Manual Action Required:** provide the Cloudflare token (or deploy
himself with the commands above); after deploy, Tony/Anna Access login check.

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
