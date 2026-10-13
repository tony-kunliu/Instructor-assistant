# TASK.md

_Last updated: 2026-10-13_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Lesson record UI (`feature/ui-lesson-record`, concept approved by Tony 2026-10-12,
his three decisions applied: number-only chips, Save only after End Lesson, Transfer/Archive left in
place for a later task) — **Completed on the branch, not merged**: navy learner header (identity, next
lesson number, 22-segment bar with derived totals, gate chips), lesson status block (Start Lesson →
running timebar + End Lesson → ended), odometer block with big derived values (duration, km, total
after save, lesson number: calculated, never typed) and the folded "Edit date / times", competency
block (Taught / Assessed grids ≥44px, gate tags on Review 1-17 / 1-22 / 23, result rows with the
official names), reminders + route block, Location/Comments, two signature pads (pad behaviour
unchanged, signed = green border), sticky "Save Lesson #N" + Discard bar with safe-area padding that
appears only once the lesson has ended and un-pins while an input has the keyboard. Legacy CSS tokens
alias the shared tokens → full dark theme (colour only elsewhere). `lib/lesson-view.ts` + tests;
qa-browser section 21 (375 light/dark running + ended, 820). No migration; payloads, validations,
data-testids and server calls unchanged. D1 stays `0012`.

**Next Recommended Task:** independent review of `feature/ui-lesson-record` (L2), merge to `staging`
(post-merge CI green), Tony's real-phone look (keyboard vs sticky bar, pads). Then, on Tony's go:
(a) move Transfer / Archive into the learner edit form's folded "More" section + learner form
restyle (concept screen B); (b) `docs/tasks` memory scheme + Memory Guard changes (Handbook §9);
(c) intake P3; (d) `scripts/check-signature-row-limits.mjs` against Staging D1; (e) fix the
`tests/pdf-export-font-subset.test.ts` temp-dir leak. P4 and 3c T2 after that.

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
