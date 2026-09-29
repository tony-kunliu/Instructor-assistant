# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Fix real Staging QA findings + permanent regression
coverage (branch `fix/learner-lifecycle-qa-findings`) — **Partial**.
Done and verified locally: 18-22 Assessed gate (server + UI), CBT&A
Completed handling (no Start Lesson, server rejects new lessons, archive
suggestion), stale selection on view switch, My learners login default;
190/190 tests, build, Memory Guard, 62/62 real-browser QA. Merged into `staging`. **Remaining:**
Cloudflare Workers Builds auto-deploy (agent cannot read Cloudflare status)
→ Tony's minimal real-Access smoke test.
Learner Lifecycle MVP is **not PASS** until then.

**Next Recommended Task:** Tony confirms the new Staging Worker version, then
a short real-Access smoke: login as Tony and as Anna → My learners; Archive
→ Restore a QA learner; a completed QA learner shows no Start Lesson; 18-22
Assessed chips locked before Review 1-17. Everything else is covered by
`npm test` and `bash scripts/qa-browser/run.sh`.

**Waiting on Other Repo:** NONE. Integration V1 follow-up (Receiver
confirming the retry event) remains open in `tony-kunliu/actgds.com`
Issue #3.

**Tony Manual Action Required:** Confirm the Staging deployment and run the
real-Access smoke test.

**Production:** UNCHANGED.
