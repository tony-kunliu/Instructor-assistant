# TASK.md

_Last updated: 2026-11-28_

This file describes the current task only. Completed work history lives in Git history and closed PRs.

**Current Task:** Lesson GPS v2 review fixes — **PR #141 is open (`feature/lesson-gps` @ `7650df8`, to staging)**. The independent review of exact HEAD `7650df8` returned **NEEDS CHANGES**: §1.2 another tab ending the lesson did not stop this tab's recording and the ending tab never saw the notes; §6.1–6.5 smaller findings (mapping doc claimed a GPS/clock cross-check that does not exist; TASK/STATUS cited the local-only commit; `sameLesson` fell back to date+start time even when both drafts carried ids; `collect()` cached by session id without stating the endedAt assumption; `start()` did not wait for the previous stop). Fixes are applied on local `feature/lesson-gps-v2` (this commit, on top of `c89a38f`, not pushed): the owning tab now stops, collects and CAS-writes the notes back into the stored draft when another tab ends its session, and the ending tab merges the notes in and adopts the notes-only revision so the finished lesson can still be saved or discarded there; `sameLesson` now trusts the draft id whenever both sides carry one; `start()` is serialised with any session still stopping. Code at `7650df8` is identical to local `812d5be` (only STATUS.md/TASK.md differed); the fix commit adds the changes above plus new unit tests for the cross-tab helpers. Tests 934 pass (5 new), tsc clean, `cf:build` passes. Nothing pushed to GitHub; nothing merged or deployed.

**Active delivery gates:**

- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI PASS; focused Browser QA PASS at `333947b`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (ACTGDS Issue #3 comment 7102354803). No live Google OAuth/calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI PASS; Browser QA PASS at `360a2c7`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (Issue #3 comment 7093882548). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** Draft; CI PASS. Superseded by PR #141 (below) — recommend closing once #141 lands (Tony to confirm). Background recording through lock screen and app switching remains an unmet release gate.
- **PR #133 — isolated iOS GPS:** Draft; CI and Xcode project build PASS. Artifact 14810301175 is unsigned and not installable as supplied. Tony will arrange signing/install and his own test when available.

**Next Recommended Task:** Push the local fix commit to `feature/lesson-gps` (PR #141) — push needs Tony's approval card. Then re-run the independent review of the new exact HEAD plus CI, and merge to staging once both pass. After that, build the suggestion tick UI: Taught / Assessed / Achieved confirmation from `lib/gps/competency-suggestions.ts` (data is ready; no UI yet). Do not merge Main/Staging wholesale: they are diverged. Then continue the already-requested exact-HEAD L3 reviews for PR #132 and #131; do not change those candidate branches while review is pending.

**Waiting on Other Repo:** NONE for this task. No shared contract or cross-repo interface change is proposed.

**Tony Manual Action Required:** Approve the push of the fix commit to `feature/lesson-gps` (PR #141, approval card) when it is pushed; decide whether to close PR #130 (superseded by #141). Later, Tony's real-iPhone GPS test (background/lock-screen recording) is the only check automation cannot do.
