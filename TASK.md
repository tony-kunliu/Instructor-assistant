# TASK.md

_Last updated: 2026-10-07_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Release B preparation (documentation only) — **Completed**.
`docs/runbooks/release-b-integration-production.md` is a checklist for the
future Production enablement of Integration V1. It is NOT an authorization;
no Production, migration, secret or deploy change was made.

Release A = PASS and the UX bugfix round is complete. Tony reported the
real-phone Sign out check OK (2026-10-07, in chat). Production Worker
`a8ec37da-9939-48d4-b1d0-fef195b0a09c` (previous
`b76eeb2c-163d-4b32-a49d-042d32063e00`, rollback target), D1 baseline
`0004`, Integration V1 OFF, no migration run.

**Next Recommended Task:** Wait. Release B is blocked by the ACTGDS
Receiver (`tony-kunliu/actgds.com`), which is not Production READY: the
Admin fix is merged but unpublished, and the Production HMAC secret is
absent. Start Release B only after the Receiver declares READY and Tony
explicitly authorizes it. Release B and P3-B are NOT STARTED.

**Waiting on Other Repo:** ACTGDS Receiver readiness (owned by Codex/Work
and Tony; not this repo).

**Tony Manual Action Required:** none for this repo right now. For the
Receiver, Tony enters `INSTRUCTOR_ASSISTANT_WEBHOOK_SECRET` on the ACTGDS
Production Site (never paste the value in chat).

**Non-blocking backlog (not scheduled):** the exact Production deploy
command (with `--env production`) is not recorded in the repo; record it
when Release B is run.
