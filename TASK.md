# TASK.md

_Last updated: 2026-11-24_

This file describes the current task only. Completed work history lives in Git history and closed PRs.

**Current Task:** Post-merge project-memory reconciliation — **Partial** on `feature/post-staging-memory-reconcile-2026-11-24`. The root snapshot records PR #134 and #135 merged to Staging, post-merge CI [45211072624](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45211072624) SUCCESS, 17/12 Main–Staging divergence, and the verified current iOS artifact. A factual ambiguity about Integration V1 was corrected at commit `3d632e0`; exact-HEAD CI [45230233413](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45230233413) passed Memory Guard before/after build, typecheck, tests and production build. This task-memory update is being committed on the same documentation-only branch; see PR #136 for the current exact HEAD and CI. Fresh independent L1 factual review remains pending (ACTGDS Issue #3 comment [7109082562](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7109082562)). No application code, database, account, calendar, learner data, credentials, OAuth, shared contract, configuration or deployment changed.

**Active delivery gates:**

- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI [45183065859](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45183065859) PASS; focused Browser QA [45182250537](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45182250537) PASS at code SHA `333947b`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is still outstanding (ACTGDS Issue #3 comment [7102354803](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7102354803)). No live Google OAuth/calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI [45118098357](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45118098357) PASS; Browser QA [45116531936](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45116531936) PASS at code SHA `360a2c7`, with only project-memory docs changed afterwards. The prior L3 PASS at `ff1b873` predates the current implementation and cannot be reused; fresh exact-HEAD review remains outstanding (Issue #3 comment [7093882548](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7093882548)). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** Draft; CI PASS. Continuous background recording through lock screen and app switching remains an unmet release gate.
- **PR #133 — isolated iOS GPS:** Draft; exact-HEAD CI and Xcode project build PASS. Current artifact `14809843453` is unsigned and not installable as supplied. Tony will arrange signing/install and his own test when available.
- **PR #135 — read-only monitor:** merged to Staging only. The hourly schedule is inactive until the workflow is on default branch `main`; no Main promotion or Production effect is claimed.

**Next Recommended Task:** Finish the fresh independent L1 factual review of PR #136 and, if it passes, merge this documentation-only change to Staging under the existing authorization and verify post-merge CI/Memory Guard. Then resume the already-requested fresh exact-HEAD L3 review of PR #132; do not change that candidate while review is pending. Keep PR #130's GPS continuity gate and PR #133's personal-device acceptance boundary unchanged.

**Waiting on Other Repo:** NONE for this documentation task. No shared contract or cross-repo interface change is proposed.

**Tony Manual Action Required:** NONE for this documentation task. Later, Tony will arrange signing/installation and his personal test of the iOS prototype. PR #131 still needs real iPhone camera / ACT card acceptance before release.
