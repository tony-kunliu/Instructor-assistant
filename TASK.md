# TASK.md

_Last updated: 2026-11-24_

This file describes the current task only. Completed work history lives in Git history and closed PRs.

**Current Task:** Harden the manual Staging D1 signature-row-limit check — Completed on `chore/signature-row-limit-remote-guard-2026-11-24`. The script now parses the target URL, rejects malformed/credential-bearing URLs, known Production hosts and remote HTTP, and requires an exact explicit acknowledgement for every non-loopback target because the check permanently creates a synthetic learner and lesson and may emit an Integration V1 event. Added subprocess regression tests for each refusal path. No remote request, D1 write or Integration event was made.

**Active delivery gates:**

- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; exact-HEAD CI PASS; focused Browser QA PASS at `333947b`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (ACTGDS Issue #3 comment 7102354803). No live Google OAuth/calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; exact-HEAD CI PASS; Browser QA PASS at `360a2c7`, with only project-memory docs changed afterwards. Fresh L3 review of exact HEAD is pending (Issue #3 comment 7093882548). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** Draft; CI PASS. Background recording through lock screen and app switching remains an unmet release gate.
- **PR #133 — isolated iOS GPS:** Draft; CI and Xcode project build PASS. Artifact 14810301175 is unsigned and not installable as supplied. Tony will arrange signing/install and his own test when available.

**Next Recommended Task:** Obtain an independent L2 review of this guard and its subprocess tests; merge to Staging only after exact-HEAD CI and review pass. The real Staging signature-row check remains a separate, deliberate remote write and must not be run automatically: it creates permanent synthetic records and may emit an Integration V1 event. Do not merge Main/Staging wholesale; they remain diverged. Continue PR #132/#131 only after their already-requested exact-HEAD L3 reviews return.

**Waiting on Other Repo:** NONE. The existing Integration V1 contract/receiver is unchanged; no cross-repo interface, endpoint or secret was changed.

**Tony Manual Action Required:** NONE for this code PR. The Staging signature-row exercise remains unrun; its remote-write acknowledgement is intentionally required before any operator runs it. Later, Tony will arrange signing/installation and his personal iOS prototype test; PR #131 still needs real iPhone camera / ACT card acceptance before release.
