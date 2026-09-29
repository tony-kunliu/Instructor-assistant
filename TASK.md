# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Staging wrap-up round (branch
`fix/chronology-and-save-error-ux`): (1) 18-22 Assessed gate now honours
lesson chronology in History Edit; (2) Save Lesson / Save changes failures
show a clear error summary next to the button with jump-to-field links;
(3) permanent QA / acceptance responsibility rule added to `AGENTS.md` §13.
See `STATUS.md` for verification evidence and the deployment state.

**Next Recommended Task:** Tony / Anna run the minimal real-account smoke
test (only what automation cannot replace): sign in with the real Cloudflare
Access account → default My learners; draw a signature on a real phone and
save one lesson on a synthetic QA learner. Then mark the Learner Lifecycle
MVP PASS. Do not re-walk workflows that `npm test` and
`bash scripts/qa-browser/run.sh` already cover.

**Waiting on Other Repo:** NONE. Integration V1 follow-up (Receiver
confirming the retry event) remains open in `tony-kunliu/actgds.com`
Issue #3.

**Tony Manual Action Required:** The minimal smoke test above.

**Non-blocking backlog (not scheduled):**
- UX: Finish odometer can be typed before Start Lesson is tapped (Tony,
  2026-09-29). Consider showing/enabling it only once the lesson is
  running or ended. Deliberately not changed in this round.
- Review 1-17 / Review 1-22 / Final Drive 23 gates are still judged against
  all of a learner's other lessons in History Edit, not by lesson order
  (only Competency 18-22 is chronology-aware). Extend if Tony wants the
  same guarantee.
- A location/comments-only History Edit still emits a propagated
  Integration event to already-exported downstream lessons (correct data,
  no private content; see `STATUS.md`).

**Production:** UNCHANGED.
