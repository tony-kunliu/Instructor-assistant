# TASK.md

_Last updated: 2026-11-24_

This file describes the current task only. Completed work history lives in Git history and closed PRs.

**Current Task:** Harden the manual Staging D1 signature-row-limit check — **Partial** (implementation and regression tests are complete on `chore/signature-row-limit-remote-guard-2026-11-24`; code candidate `268b6667dd4066a5048b9875714b53b8c2575052` has exact-code CI [45288249167](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45288249167) SUCCESS; the fresh independent L2 review is pending). The script now parses the target URL, rejects malformed/credential-bearing URLs, known Production hosts and remote HTTP, and requires an exact explicit acknowledgement for every non-loopback target because the check permanently creates a synthetic learner and lesson and may emit an Integration V1 event. Added subprocess regression tests for each refusal path. No remote request, D1 write or Integration event was made.

**Documentation reconciliation:** `STATUS.md` now uses the verified post-merge snapshot from PR #136, including the 17/12 Main–Staging divergence, Release #25 evidence, correct Integration V1 state and verified iOS artifact. `TASK.md` remains specific to PR #137. PR #136 is still open with overlapping documentation; do not merge its separate task pointer over this branch. After PR #137 is accepted, verify whether PR #136 is fully superseded before closing it.

**Active delivery gates:**

- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI PASS; focused Browser QA PASS at `333947b`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (ACTGDS Issue #3 comment 7102354803). No live Google OAuth/calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI PASS; Browser QA PASS at `360a2c7`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (Issue #3 comment 7093882548). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** Draft; CI PASS. Background recording through lock screen and app switching remains an unmet release gate.
- **PR #133 — isolated iOS GPS:** Draft; CI and Xcode project build PASS. Artifact 14809843453 is unsigned and not installable as supplied. Tony will arrange signing/install and his own test when available.

**Next Recommended Task:** Obtain an independent L2 review of the current PR #137 HEAD. After PASS and exact-HEAD CI, merge to Staging under the existing authorization and verify post-merge CI/Memory Guard. The real Staging signature-row check remains a separate, deliberate remote write and must not be run automatically: it creates permanent synthetic records and may emit an Integration V1 event. Do not merge Main/Staging wholesale; they remain diverged. Continue PR #132/#131 only after their already-requested exact-HEAD L3 reviews return.

**Waiting on Other Repo:** NONE. The existing Integration V1 contract/receiver is unchanged; no cross-repo interface, endpoint or secret was changed.

**Tony Manual Action Required:** NONE for this code PR. The Staging signature-row exercise remains unrun; its remote-write acknowledgement is intentionally required before any operator runs it. Later, Tony will arrange signing/installation and his personal iOS prototype test; PR #131 still needs real iPhone camera / ACT card acceptance before release.
