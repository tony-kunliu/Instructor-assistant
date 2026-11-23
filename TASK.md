# TASK.md

_Last updated: 2026-11-23_

**Current Task:** iOS Core Location self-test PR #133 — Partial. The standalone SwiftUI/Core Location project compiled unsigned for generic iOS on source `7c1f13651b5f413a034b62ddd6700900ee8dab75`. GitHub CI run [44989249762](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/44989249762) and Xcode build run [44989249829](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/44989249829) passed. The verified project artifact is ID `14741550719` (8,611 bytes), expires `2026-12-06T05:24:55Z`. It is unsigned; no iPhone installation or native field test has occurred.

**Next Recommended Task:** Wait for Tony to arrange the approved Apple signing and installation route. Once an installable build exists, Tony will perform his own single approximately 20-minute personal test covering foreground, lock screen, another app and foreground recovery. Then evaluate only the aggregate summary. Do not seek external testers, send reminders, or lower PR #130’s continuous-background-recording release gate.

**Waiting on Other Repo:** NONE. No cross-repo interface, contract, endpoint or secret change is included.

**Tony Manual Action Required:** NONE requested now. Tony will arrange signing, installation and his own device test when available.

**Other active PR gates:**
- PR #132 calendar: HEAD `f631cea8abc21f17cd19830787eb049c62f1cbfc`; exact-HEAD CI `45135467719` passed; fresh-context L3 review remains pending (ACTGDS Issue #3 comments `7094977645` and `7096925471`). No real OAuth or live calendar data.
- PR #131 licence photo: HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI `45118098357` passed; Browser QA `45116531936` passed at the same-code SHA `360a2c7`, with only three later documentation commits. Fresh-context L3 review remains pending (ACTGDS Issue #3 comment `7093882548`); real iPhone camera and ACT licence acceptance remain open.
- PR #130 lesson GPS: Draft at `a8337ff85936a68a43ad1a4114a4cad6240002e7`; CI `44960761857` passed. Continuous background recording, lock-screen and app-switch acceptance remain release gates. Existing L3 findings and Tony’s consent/export-content decisions remain open.

**Release boundary:** PR #133 remains Draft and unsigned. No merge, Staging deployment, Production deployment, signing, live location collection or learner data access in this task.
