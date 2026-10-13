# TASK.md

_Last updated: 2026-10-13_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Appearance toggle in the top bar (Tony's decision 2026-10-13 after testing PR #77 on
Staging), branch `feature/ui-theme-toggle-top` — **Completed on the branch, not merged** (presentation
only, L1): the footer System / Light / Dark group is gone; one small icon button at the end of the top
bar's brand row (44px hit area around a 32px disc, moon on light / sun on dark, accessible name
"Switch to dark theme" / "Switch to light theme", gold focus ring, beside "Signed in as / Sign out"
without crowding at 375px). First state = the phone's appearance (and it follows the phone until a
tap); a tap switches to the opposite and stores the explicit choice in localStorage (try/catch, works
with storage blocked; old stored "system" / "light" / "dark" still read). The no-flash boot script in
`app/layout.tsx` and the theme-color meta sync are unchanged. `lib/theme.ts` (`effectiveTheme`,
`toggledTheme`, `toggleLabel`) + `tests/theme.test.ts`; qa-browser section 22 rewritten (toggle
state/aria/icon, persistence, no-flash with JS bundles blocked, legacy "system", phone flip, storage
blocked, top bar geometry at 375/820, contrast ≥4.5:1 in both themes). The PR #77 "only the form"
behaviour is unchanged. No migration; payloads, validations, data-testids and server calls unchanged.
D1 stays `0012`.

**Next Recommended Task:** merge `feature/ui-theme-toggle-top` to `staging` (L1: author checks + CI,
no independent review), Tony's real-phone look (toggle position in the bar, no flash on a cold start,
iOS status-bar colour). Then, on Tony's go: (a) move Transfer / Archive into the learner edit form's
folded "More" section + learner form restyle (concept screen B); (b) `docs/tasks` memory scheme +
Memory Guard changes (Handbook §9); (c) intake P3; (d) `scripts/check-signature-row-limits.mjs`
against Staging D1; (e) fix the `tests/pdf-export-font-subset.test.ts` temp-dir leak. P4 and 3c T2
after that.

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
