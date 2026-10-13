# TASK.md

_Last updated: 2026-10-13_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Tony's two Staging findings on the UI redesign (2026-10-13), branch
`feature/ui-theme-switch-new-learner` — **Completed on the branch, not merged** (presentation only,
L2 one review round per Handbook §2): (1) Appearance switch System / Light / Dark in the footer
(≥44px, `aria-pressed`): sets `data-theme` on `<html>` (the existing CSS tokens do the rest), remembers
the choice in localStorage (every access try/catch; works with storage blocked), an inline boot script
in `app/layout.tsx` applies it before paint (no flash; `suppressHydrationWarning` on `<html>`),
`color-scheme` follows via CSS and both `theme-color` metas are rewritten to the chosen navy;
`lib/theme.ts` + `tests/theme.test.ts`. (2) "+ New learner" and "Edit learner" show only the form:
the open learner's list card and all panels (header, lesson, progress, history) are hidden while the
form is open; the list keeps just "Show all learners (N)"; the form scrolls to the top (scroll-margin
for the safe area); detail, selection and the running-lesson draft are untouched, Cancel / Save
restore the panels (`lib/learner-card.ts#collapsedCards`). qa-browser section 22 (375 light/dark with
the form open, no-flash with JS bundles blocked, storage blocked, contrast ≥4.5:1, 820). No migration;
payloads, validations, data-testids and server calls unchanged. D1 stays `0012`.

**Next Recommended Task:** independent review (one round, L2 presentation-only) of
`feature/ui-theme-switch-new-learner`, merge to `staging` (post-merge CI green), Tony's real-phone
look (switch in the footer, no flash on cold start, PWA status-bar colour). Then, on Tony's go:
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
