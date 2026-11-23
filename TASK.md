# TASK.md

_Last updated: 2026-11-23_

This file describes the current task only. Completed work's detail lives in git log and closed PRs.

**Current Task — Today’s lessons PR #132:** Partial. The pickup parser now stops multiline address values at adjacent phone/email field labels and falls back to a valid event location; regression tests are committed on `feature/today-lessons`. Code/test commit `77cbc93` passed GitHub CI run `45100677193` (Memory Guard, type check, full tests and build); subsequent commits only update project memory. Independent L3 re-review remains pending. This change does not configure or test a real Google OAuth connection.

**Next Recommended Task:** Verify CI and obtain an independent L3 review against the exact final PR #132 head. Then verify only the previously authorised read-only calendar source on Staging. Do not add accounts, widen scopes or configure credentials without Tony’s separate approval. After #132, continue the authorised PR #131 review and automated QA.

**Waiting on Other Repo:** NONE. No cross-repo interface, contract, endpoint or secret changes are included.

**Tony Manual Action Required:** NONE for this parser change. Real calendar source, OAuth credentials and permissions remain a separate approval. Tony will arrange iOS GPS signing, installation and his own device test when available; do not seek external testers or send reminders.

**GPS hold:** PR #133 remains draft; retain its unsigned Xcode artifact and do not start signing or installation. PR #130 remains draft; continuous background recording through lock-screen and app-switch phases remains a release gate. Await Tony’s results before changing either PR.

**Release boundary:** No merge to `staging`, `main` or Production in this task. No real learner data, migration or live calendar configuration.
