# TASK.md

_Last updated: 2026-10-12_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Docs status sync (`docs/status-sync-20261012`, docs only) — **Completed**.
Production releases #12 (3c T1, `0011`), #13 (iPad layout, intake P2 address suggestions,
`0012`, Operating Handbook) and #14 (R10a route reminders, no migration) all succeeded;
Production and Staging D1 are at `0012`. Detail: STATUS.md "Current Snapshot".

**Next Recommended Task:** one of, on Tony's go: (a) `docs/tasks` memory scheme + Memory
Guard changes (Handbook §9, §14 follow-up b); (b) intake P3 (overseas/interstate licence
fields, additive columns); (c) run `scripts/check-signature-row-limits.mjs` against Staging
D1 (never Production) to close the iPad signature row-limit check; (d) fix the
`tests/pdf-export-font-subset.test.ts` temp-dir leak. P4 (iOS Scan Text + local parser) and
3c T2 after that.

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
