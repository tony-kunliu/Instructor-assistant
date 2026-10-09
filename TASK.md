# TASK.md

_Last updated: 2026-10-09_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** PDF export font subset — **Completed** on `feature/pdf-font-subset`
(not merged). The export embeds only the glyphs used (typical 29-180 KB, was 14 MB);
rare CJK characters fall back to the 16 MB full font (export ~13.9 MB, as before).
Missing non-CJK characters trigger a confirmation before the PDF downloads. Typecheck,
398 tests, `cf:build`, Memory Guard, qa-browser 189/189 pass. No migration, no contract change.

**Next Recommended Task:** independent code review of `feature/pdf-font-subset`, then
merge to `staging` per AGENTS.md §14 and verify the PDF on Staging. Before this
merge, decide on the `☂`-style symbol gap in STATUS.md Known Issues.

**Learner edit (`feature/learner-edit`):** merged to `staging` and `main`. Still to
check: migration `0008` on Staging and Production D1 (read-only `wrangler d1 migrations list`).

**Waiting on Other Repo:** ACTGDS display fixes and first-event
confirmations (Issue #3). Nothing blocks this task (no contract change).

**Tony Manual Action Required:** NONE.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare Workers Builds skip them.
