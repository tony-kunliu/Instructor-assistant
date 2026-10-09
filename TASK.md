# TASK.md

_Last updated: 2026-10-09_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** PDF export diagnostics (status line naming the characters that forced the full font; subset adds en/em spaces, ℃, №) — **Completed** on `feature/pdf-font-diagnostic` (not merged). Font subset itself is on `staging` (PR #31). The export embeds only the glyphs used (typical 29-180 KB, was 14 MB);
rare CJK characters fall back to the 16 MB full font (export ~13.9 MB, as before).
Missing non-CJK characters trigger a confirmation before the PDF downloads. Typecheck,
404 tests (2 poppler tests skip without pdftotext), `cf:build`, Memory Guard, qa-browser 194/194 pass. No migration, no contract change.

**Next Recommended Task:** deploy this branch to Staging, export "Qa phase1" and read the
status line to find the character that forced the 13.9 MB PDF; then decide on the coverage
gap in STATUS.md Known Issues.

**Learner edit (`feature/learner-edit`):** merged to `staging` and `main`. Still to
check: migration `0008` on Staging and Production D1 (read-only `wrangler d1 migrations list`).

**Waiting on Other Repo:** ACTGDS display fixes and first-event
confirmations (Issue #3). Nothing blocks this task (no contract change).

**Tony Manual Action Required:** NONE.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare Workers Builds skip them.
