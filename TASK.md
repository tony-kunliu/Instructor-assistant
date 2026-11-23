# TASK.md

_Last updated: 2026-11-23_

**Current Task:** PR #131 learner licence photo intake — Partial. Commit `c08a67e` makes the 30 s timeout abort pending image decode, canvas conversion and OCR buffer preparation. Two focused unit tests passed locally. The first hosted CI attempt stopped at Memory Guard because STATUS.md and TASK.md exceeded their size limits; later CI steps were skipped. The timeout-during-decode Chromium regression is added but not yet executed.

**Next Recommended Task:** Re-run exact-HEAD CI after this memory correction, then execute the focused Chromium QA at 375 px and 820 px and obtain a fresh independent L3 review of the final SHA. Do not merge before those gates pass.

**Waiting on Other Repo:** NONE.

**Tony Manual Action Required:** Before release, test the camera picker with a genuine ACT learner card on iPhone. PR #130 remains Draft until background continuous recording, lock-screen and app-switch acceptance; PR #133's unsigned Xcode prototype is ready for Tony's later self-test. No external tester or reminder.

**Other active PR gates:**
- PR #132 calendar: CI passed on `a4c5f248`; the L3 code verdict is pinned to older `34c41aa`. Exact-head independent review and approved real-calendar OAuth/Staging verification remain outstanding.
- PR #133 iOS GPS: unsigned macOS build passed on `7c1f136`; signing, installation and Tony's device test remain.
