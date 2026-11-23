# TASK.md

_Last updated: 2026-11-24_

This file describes the current task only. Completed work history lives in Git history and closed PRs.

**Current Task:** Project-memory accuracy refresh — **Completed on `feature/project-memory-sync-2026-11-24`**. Reconciled the root snapshot and handoff with remote Main/Staging refs, exact open PR heads, CI and Browser QA runs, Production Release #25 logs and recorded D1 migration levels. Documentation-only; no application code, database, account, calendar, learner data, configuration or deployment changed. Proposed in a PR to `staging`; not merged.

**Active delivery gates:**

- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI PASS; focused Browser QA PASS at `333947b`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (ACTGDS Issue #3 comment 7102354803). No live Google OAuth/calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI PASS; Browser QA PASS at `360a2c7`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (Issue #3 comment 7093882548). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** Draft; CI PASS. Background recording through lock screen and app switching remains an unmet release gate.
- **PR #133 — isolated iOS GPS:** Draft; CI and Xcode project build PASS. Artifact 14810301175 is unsigned and not installable as supplied. Tony will arrange signing/install and his own test when available.

**Next Recommended Task:** Independently verify the factual accuracy of this project-memory refresh PR and its Memory Guard/CI result. Merge to Staging only after review and required checks pass. Do not merge Main/Staging wholesale: they are diverged. Then continue the already-requested exact-HEAD L3 reviews for PR #132 and #131; do not change those candidate branches while review is pending.

**Waiting on Other Repo:** NONE for this documentation task. Review coordination is recorded in ACTGDS Issue #3; no shared contract or cross-repo interface change is proposed.

**Tony Manual Action Required:** NONE for this documentation task. Later, Tony will arrange signing/installation and his personal test of the unsigned iOS prototype. PR #131 still needs real iPhone camera / ACT card acceptance before release.
