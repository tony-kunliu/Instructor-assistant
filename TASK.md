# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner Lifecycle / CBT&A Staging round — **Completed**
(PASS). Real-account / real-phone acceptance by Tony passed; the History
Edit chronology gates (Review 1-17, Competency 18-22, Review 1-22, Final
Drive 23), the save-failure error summary and the QA/acceptance working
rule are in `staging`, verified by 252 automated tests, real-browser QA
(`bash scripts/qa-browser/run.sh`, 91 checks) and GitHub CI. Details and
the exact rules live in `STATUS.md`.

**Next Recommended Task:** None scheduled. Pick from the backlog below (or
a new feature) only on Tony's go-ahead.

**Waiting on Other Repo:** NONE. Integration V1 follow-up (Receiver
confirming the retry event) remains open in `tony-kunliu/actgds.com`
Issue #3.

**Tony Manual Action Required:** NONE.

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
