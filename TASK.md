# TASK.md

_Last updated: 2026-11-24_

This file describes the current task only. Completed work's detail lives in git log and closed PRs.

**Current Task — Today’s lessons PR #132:** Partial. The pickup/contact parser rejects adjacent phone/email labels, validates location candidates before Directions, excludes explicitly negative lesson titles and requires positively identified learner contacts. Five existing review threads were verified against regression cases and resolved. Implementation/test SHA `49b19eeb7fb62a029e4883f00ea3544685f7d467` passed CI `45120879144` (908 tests, typecheck, build and Memory Guard). Added an isolated Browser QA runner/workflow; run `45182250537` passed at 375px/820px on code SHA `333947b2aa55d47fe30f81705fcb9d13de09ac5d`, covering gateway failure, malformed response, retry, overlap, partial calendar and learner reselection. Exact-HEAD CI `45182263993` passed on that SHA (908 tests, typecheck, build and both Memory Guard checks). The subsequent project-memory update is documentation-only; no application or QA code changed. Fresh independent review of the workflow-inclusive final HEAD remains pending. No real OAuth, calendar, learner data, Staging or Production was touched.

**Next Recommended Task:** Obtain a fresh independent review for the final exact PR #132 HEAD (Issue #3 request `7102354803`). Do not merge while it is pending. After a PASS, perform only the previously scoped read-only Staging verification; do not configure OAuth, add accounts or widen scopes without Tony’s separate approval. Then resume PR #131’s exact-head L3 review request [7093882548](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7093882548).

**Waiting on Other Repo:** NONE. No cross-repo interface, contract, endpoint or secret changes are included.

**Tony Manual Action Required:** NONE for this parser change. Real calendar source, OAuth credentials and permissions remain a separate approval. Tony will arrange iOS GPS signing, installation and his own device test when available; do not seek external testers or send reminders.

**GPS hold:** PR #133 remains draft; retain its unsigned Xcode artifact and do not start signing or installation. PR #130 remains draft; continuous background recording through lock-screen and app-switch phases remains a release gate. Await Tony’s results before changing either PR.

**Release boundary:** No merge to `staging`, `main` or Production in this task. No real learner data, migration or live calendar configuration.
