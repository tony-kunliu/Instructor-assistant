# TASK.md

_Last updated: 2026-10-12_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner list UI (`feature/ui-learner-list`, concept approved by Tony
2026-10-12) — **Completed on the branch, not merged**: shared CSS tokens (website navy/gold/paper,
light + dark), navy top bar with "+ New learner", search, Mine/All/Archived counts, glance line,
one card per learner (initials, meta, 22-segment bar, Review 1-17 / 1-22 / Final Drive 23 chips,
C23-from / licence chips). Card data from ONE set-based D1 aggregate (`listLearnerSummaries`; the
list GET is 2 statements, 0 binds); no migration; contract untouched. Needs independent review
(cross-model, Handbook §2) before `staging`. Production and Staging D1 stay at `0012`.

**Next Recommended Task:** independent review + merge of `feature/ui-learner-list` to
`staging`, then Tony's real-phone look (light and dark). After that, on Tony's go: (a) `docs/tasks`
memory scheme + Memory Guard changes (Handbook §9); (b) intake P3; (c) run
`scripts/check-signature-row-limits.mjs` against Staging D1; (d) fix the
`tests/pdf-export-font-subset.test.ts` temp-dir leak; (e) migrate the remaining screens to the
new tokens (full dark theme). P4 and 3c T2 after that.

**Waiting on Other Repo:** ACTGDS: notify-tick (lesson notifications) waits for Website PR
#47 rework and Tony's explicit approval of the new endpoint + secret (Production stays OFF);
Work's display polish list. Nothing blocks this repo.

**Tony Manual Action Required:** none blocking. Optional: (1) answer whether to hide the
ACT "Jerrabomberra" district in Address suggestions (BACKLOG); (2) the 30-minute tooling
checklist, not done yet: GitHub Dependabot alerts + push protection, merge the duplicate
GitHub environments, claude.ai plugins (Security Guidance, claude-security, Cloudflare
read-only).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
