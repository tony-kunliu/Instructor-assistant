# TASK.md

_Last updated: 2026-11-23_

This file describes the current task only. Completed work's detail lives in git log and closed PRs.

**Current Task — Today’s lessons PR #132:** Partial. The pickup/contact parser rejects phone and email field labels when they follow a multiline pickup label, validates calendar location candidates before using them for Directions, distinguishes explicitly negative lesson titles, and only returns positively identified learner contact fields. Five existing review threads were verified against the current implementation and regression tests, then resolved on PR #132. Exact HEAD `49b19eeb7fb62a029e4883f00ea3544685f7d467`; CI run [45120879144](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45120879144) passed (908 tests, typecheck, build and Memory Guard). This does not replace the required fresh-context L3 review.

**Next Recommended Task:** Obtain the already-requested independent fresh-context L3 review against exact PR #132 HEAD (Issue #3 request [7092871977](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7092871977)). Do not duplicate the request or merge while it is pending. After a PASS, continue the bounded, previously authorised read-only calendar Staging verification; do not configure OAuth, add accounts or widen scopes without Tony’s separate approval. Then resume PR #131's exact-head L3 review request [7093882548](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7093882548).

**Waiting on Other Repo:** NONE. No cross-repo interface, contract, endpoint or secret changes are included.

**Tony Manual Action Required:** NONE for this parser change. Real calendar source, OAuth credentials and permissions remain a separate approval. Tony will arrange iOS GPS signing, installation and his own device test when available; do not seek external testers or send reminders.

**GPS hold:** PR #133 remains draft; retain its unsigned Xcode artifact and do not start signing or installation. PR #130 remains draft; continuous background recording through lock-screen and app-switch phases remains a release gate. Await Tony’s results before changing either PR.

**Release boundary:** No merge to `staging`, `main` or Production in this task. No real learner data, migration or live calendar configuration.
