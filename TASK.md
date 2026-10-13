# TASK.md

_Last updated: 2026-10-13_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner form restyle (concept screen B, approved 2026-10-12) + Tony's decision 3 (Transfer and
Archive into the EDIT form's folded "More"), branch `feature/ui-learner-form` — **Completed on the branch; one
independent review round to arrange (L2, presentation only: layout, markup, wording; no change to data, rules,
queries, payloads, permissions or ownership logic)**. Student / Address / Licence & eligibility cards (P3 group kept),
picked-address chips, inline required-name error (server wording, server validation unchanged), sticky Save bar
(`env(safe-area-inset-bottom)`, un-pins while a field has focus), Cancel link; "More" holds the unchanged Transfer and
Archive panels (same handlers, `phase !== "ready"` guard, testids, confirmations); the inactive-owner rescue transfer
keeps its page link. `lib/learner-form-view.ts` + `tests/learner-form-view.test.ts`; qa-browser section 24 (375
light/dark New + Edit with More open, 820 two-column, More e2e transfer + archive + restore, sticky bar vs focus);
sections 3/13/16/17/21/22 selectors updated for the move; section 23's stale theme selectors fixed. No migration,
no dependency, contract untouched.

**Next Recommended Task:** independent review (one round, L2 presentation) → merge to `staging` → post-merge CI →
Tony's real-phone look (375px: sticky bar with the iOS keyboard, More fold, date pickers) → release with P3
(`0013`). Then, on Tony's go: (a) `docs/tasks` memory scheme; (b) intake P4 (iOS Scan Text + local parser);
(c) `scripts/check-signature-row-limits.mjs` on Staging D1.

**Waiting on Other Repo:** ACTGDS: notify-tick waits for Website PR #47 rework and Tony's explicit
approval of the new endpoint + secret (Production stays OFF); Work's display polish list. Nothing
blocks this repo.

**Tony Manual Action Required:** none blocking (P3 questions answered 2026-10-13: count from the
earlier licence; keep the separate grey line; keep the country list). Optional, still open: hide the ACT "Jerrabomberra" district in
Address suggestions; the 30-minute tooling checklist (Dependabot, duplicate environments, plugins).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare
Workers Builds skip them. Simulate the Workers Builds command locally before merging (see STATUS.md CI).
