# TASK.md

_Last updated: 2026-11-23_

**Current Task:** PR #131 learner licence photo intake — Partial. Added Browser QA trigger coverage for `public/**`, `next.config.ts`, and `scripts/prepare-licence-ocr.ts`, so changes to the OCR asset pipeline cannot skip browser E2E. Commit `360a2c7356afad9ae96aa6a604b3ddd5cb582b18`. CI run [45116536144](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45116536144) passed Memory Guard, Poppler, typecheck, full tests, production build and post-build Guard. Browser QA run [45116531936](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45116531936) is still in progress on the same SHA. The preceding Browser QA run [45113177144](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45113177144) passed at 375px and 820px, including OCR cancellation, timeout, retry, reviewed save, no image upload and text fallback.

**Next Recommended Task:** Verify run `45116531936` reaches a terminal result, then obtain a fresh independent L3 review of the exact PR #131 HEAD. Do not merge before that review passes.

**Waiting on Other Repo:** NONE.

**Tony Manual Action Required:** Before release, accept a genuine ACT learner licence camera scan on iPhone. Tony will arrange the iOS GPS self-test personally; no external tester or reminder. PR #130 remains Draft until background continuous recording, lock-screen and app-switch acceptance. PR #133 remains Draft and unsigned.

**Other active PR gates:**
- PR #132 calendar: CI passed on `a4c5f248`; the L3 verdict is pinned to `34c41aa`, not the current HEAD. Exact-head review and approved read-only Google Calendar Staging verification remain outstanding; no real OAuth configured.
- PR #130 GPS: Draft; CI passed on `a8337ff`; background continuous recording, lock-screen and app-switch acceptance remain required.
- PR #133 iOS GPS: Draft; CI and unsigned macOS build passed on `7c1f136`; signing, installation and Tony's test remain.
