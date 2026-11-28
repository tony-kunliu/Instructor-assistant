# TASK.md

_Last updated: 2026-11-28_

This file describes the current task only. Completed work history lives in Git history and closed PRs.

**Current Task:** Lesson GPS v2 — **Completed on `feature/lesson-gps-v2` (commit `812d5be`, local only, not pushed)**. Ports #130's lesson-GPS core with the cross-tab draft lifecycle rewritten (CAS envelope + tombstones, tab ownership, idempotent collect, Web Lock save); adds turn detection, junction list, signal waits, speed stats, and new manoeuvre detection (reversing, three-point turns, possible lane changes, stops/moving-off with approach deceleration); GPS notes now carry a time-ordered evidence trail and a route summary for the form's Location column (auto-fills only when empty); adds the competency suggestion list as pure data (11 of 22 competencies, instructor confirms, never auto-Achieves). Design doc `docs/gps-cbt-mapping.md` is written against ACT form 10,044 (7/2002), per-column source/definition/boundary; the checklist PDF export was verified against the same template (no discrepancy). Tests 929 pass (7 new), tsc clean, `cf:build` passes. Nothing pushed to GitHub; nothing merged or deployed.

**Active delivery gates:**

- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI PASS; focused Browser QA PASS at `333947b`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (ACTGDS Issue #3 comment 7102354803). No live Google OAuth/calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI PASS; Browser QA PASS at `360a2c7`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (Issue #3 comment 7093882548). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** Draft; CI PASS. Superseded by `feature/lesson-gps-v2` — recommend closing once the v2 PR is open. Background recording through lock screen and app switching remains an unmet release gate.
- **PR #133 — isolated iOS GPS:** Draft; CI and Xcode project build PASS. Artifact 14810301175 is unsigned and not installable as supplied. Tony will arrange signing/install and his own test when available.

**Next Recommended Task:** Independent review of `feature/lesson-gps-v2` (commit `812d5be`), then open a PR to staging (push needs Tony's approval card). After that, build the suggestion tick UI: Taught / Assessed / Achieved confirmation from `lib/gps/competency-suggestions.ts` (data is ready; no UI yet). Do not merge Main/Staging wholesale: they are diverged. Then continue the already-requested exact-HEAD L3 reviews for PR #132 and #131; do not change those candidate branches while review is pending.

**Waiting on Other Repo:** NONE for this task. No shared contract or cross-repo interface change is proposed.

**Tony Manual Action Required:** Approve the push of `feature/lesson-gps-v2` (approval card) when the PR is opened; decide whether to close PR #130 (superseded by v2). Later, Tony's real-iPhone GPS test (background/lock-screen recording) is the only check automation cannot do.
