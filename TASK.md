# TASK.md

_Last updated: 2026-10-21_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**SaaS edition P1 (2026-10-28):** `Current Task:` Completed, merged to `staging` (PR #124, L3, reviewed). `Next Recommended Task:` P2 (plan Task 6): Tony makes a Zero Trust team + Access app (One-time PIN, Everyone, ~30-day session), picks the hostname; then the agent adds `[env.saas]`, creates the D1, migrates and deploys. `Waiting on Other Repo:` NONE. `Tony Manual Action Required:` P2 steps; fill the 9 bracketed placeholders in /terms and /privacy; decide the product name; ask Access Canberra about using the CBT&A list commercially. Release gate: the next Production release carries shared-file changes and needs Tony's go.

**Current Task:** Lesson GPS and CBT&A checklist — implementation on `feature/lesson-gps-checklist`.
Opt-in Start and End capture lead to editable, estimated ACT junction and daylight notes in Comments.
The existing checklist save keeps the reviewed text. Raw GPS is device-local. No schema, PDF or integration contract change.

**Side task (dot / Tony "keep iterating", 2026-10-16):** `chore/manifest-colours` (draft PR #86) — the installed app's
`app/manifest.ts` colours move to the light tokens (`--paper` #f6f3eb, `--navy` #0b1b2b); `tests/manifest-colours.test.ts`
keeps manifest, stylesheet and `/gps` manifest in step; `scripts/qa-browser/manifest.mjs` checks both manifests as served
(content type, colours, icon, links, theme-color metas) at phone + iPad widths, light + dark. Tier recorded: **L2
presentation-only** (author "L1/L2", reviewer L2 under the §2 doubt rule). No data, schema, contract or permission change.
Draft, not merged; needs Tony's go. Unlocated: the first full unit run was 762/763 (name not captured; 7 later runs clean).

**Next Recommended Task:** Verify a real iPhone route (including lock and another app) in a non-production environment.
If GPS gaps persist, move capture to Core Location and keep the existing lesson/checklist workflow. PR #83 (learner form + Transfer / Archive in "More") is merged to `staging` (bc1e0cb) and awaits Tony's phone
check + Production release. Still queued: intake P4 (iOS Scan Text + local parser), `docs/tasks` memory scheme,
`scripts/check-signature-row-limits.mjs` on Staging D1.

**Waiting on Other Repo:** ACTGDS: notify-tick waits for Website PR #47 rework and Tony's explicit approval of the
new endpoint + secret (Production stays OFF). Nothing blocks this repo.

**Side task (dot / Tony, 2026-10-16):** `feature/gps-earlier-summaries` — `/gps` "Earlier recordings": the newest five rows show
one line (`16.99 km · Recorded 27.1 min · Coverage 97.4%`), the Results card's own numbers via `lib/gps/format.ts`: a read-only
in-memory projection (`lib/gps/earlier.ts`, existing `summarizeTrack`; a malformed record degrades alone). No capture, write,
consent, lesson, API or location change. Tier L2. Draft PR #87 to `staging`.

**Tony Manual Action Required:** real iPhone road test after preview deployment. At next release review, confirm
which GPS estimates belong in exported Comments. Optional: hide Jerrabomberra in Address suggestions.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare Workers
Builds skip them. Simulate the Workers Builds command locally before merging (see STATUS.md CI).
