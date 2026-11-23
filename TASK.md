# TASK.md

_Last updated: 2026-11-24_

**Current Task:** iOS Core Location self-test PR #133 — Partial. The standalone SwiftUI/Core Location project compiled unsigned for generic iOS on exact PR HEAD `6f9d1b93672c3fc45fe01f6cd8351582ed8101da`. Exact-HEAD GitHub CI run [45160071619](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45160071619) and Xcode project build run [45160071574](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45160071574) passed. Current artifact is ID `14809843453` (8,612 bytes), SHA-256 `0426c851f35fab78654fe8a087d7f420482fb603f972202928bb5cd116765d9d`, expires `2026-12-07T10:53:40Z`. It is an unsigned Xcode project, not an installable IPA; no iPhone installation or native field test has occurred.

**Next Recommended Task:** Wait for Tony to arrange approved Apple development-team signing and installation. Once the app is signed and installable, Tony will perform his own single approximately 20-minute personal test covering foreground, lock screen, another app and foreground recovery; then evaluate only the aggregate summary. Do not seek external testers, send reminders, or lower PR #130’s continuous-background-recording release gate.

**Waiting on Other Repo:** NONE. No cross-repo interface, contract, endpoint or secret change is included.

**Tony Manual Action Required:** NONE requested now. Tony will arrange signing, installation and his own device test when available.

**Other active PR gates:**
- PR #132 calendar: HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI `45183065859` passed; Browser QA `45182250537` passed on code SHA `333947b2aa55d47fe30f81705fcb9d13de09ac5d` at 375/820px. Fresh-context L3 review is requested for this exact HEAD in ACTGDS Issue #3 comment `7110650174`; the prior request was pinned to `f631cea`. Base remains `1d14f989`, behind current Staging `8647703`; reconcile and rerun gates before Staging merge. No real OAuth or calendar data.
- PR #131 licence photo: HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI `45118098357` passed; Browser QA `45116531936` passed at code SHA `360a2c7` at 375/820px, with only documentation changes after that tested code. Fresh-context L3 review remains pending at this exact HEAD (ACTGDS Issue #3 comment `7093882548`); base `1d14f989` predates current Staging `8647703`. Real iPhone camera and ACT licence acceptance remain open.
- PR #130 lesson GPS: Draft at `a8337ff85936a68a43ad1a4114a4cad6240002e7`; CI `44960761857` passed. Continuous background recording, lock-screen and app-switch acceptance remain release gates. Existing L3 findings and Tony’s consent/export-content decisions remain open.
- PR #136 project-memory reconciliation: HEAD `739de6db63bff6b6a917ffdad355bc396ea00ed9`; exact-HEAD CI `45231766623` passed. Fresh independent L1 factual review remains pending (ACTGDS Issue #3 comment `7109082562`).

**Release boundary:** PR #133 remains Draft and unsigned. No merge, Staging deployment, Production deployment, signing, live location collection or learner data access in this task.
