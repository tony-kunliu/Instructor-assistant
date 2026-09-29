# TASK.md

_Last updated: 2026-09-29_

This file describes the **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner List Usability & Lifecycle MVP — **Partial /
Blocked on deploy.** Done: feature merged into `staging` (merge of
`98fd33c`), no migration, no Integration V1 change; typecheck + 124/124
tests + build + Memory Guard verified on merged code. **Blocked:** Staging
deploy (no Cloudflare credentials in the agent environment) and real
Cloudflare Access QA as Tony and Anna. Not marked PASS until both are done.

**Next Recommended Task:** Deploy Staging from `staging`
(`npm run cf:deploy`, Staging env — no migration to apply), then run the
real-Access QA on a synthetic QA learner: Tony/Anna default My learners →
All → search → Archive → refresh → Archived → Restore → refresh; archived
learner shows no Start Lesson; Final Drive 23 learner shows suggestion only
(no auto-archive); Start Lesson still works; confirm no new outbox rows from
Archive/Restore.

**Waiting on Other Repo:** NONE for this feature. Integration V1 follow-up
(Receiver confirming the retry event) remains open in
`tony-kunliu/actgds.com` Issue #3.

**Tony Manual Action Required:** Either run the Staging deploy and the real
login QA yourself, or give the agent Cloudflare credentials plus a way to
act as Tony/Anna (real Access sessions cannot be simulated by the agent).

**Production:** UNCHANGED.
