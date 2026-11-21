# TASK.md

_Last updated: 2026-10-21_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**SaaS edition P1 (2026-10-28):** `Current Task:` Completed, merged to `staging` (PR #124, L3, reviewed). `Next Recommended Task:` P2 (plan Task 6): Tony makes a Zero Trust team + Access app (One-time PIN, Everyone, ~30-day session), picks the hostname; then the agent adds `[env.saas]`, creates the D1, migrates and deploys. `Waiting on Other Repo:` NONE. `Tony Manual Action Required:` P2 steps; fill the 9 bracketed placeholders in /terms and /privacy; decide the product name; ask Access Canberra about using the CBT&A list commercially. Release gate: the next Production release carries shared-file changes and needs Tony's go.

**Learner licence intake:** Direct local photo/text scan into New learner is on `feature/learner-licence-photo`. It creates the learner after review through the existing Save action. Next: test a real ACT card and the camera picker on iPhone.

**Current Task:** P4 GPS phase 1, isolated default-OFF GPS recorder (`feature/gps-p4-recorder`) — **Merged to `staging` (PR #84, 62923cf), deployed to Staging** (L2 isolated: new `/gps` page + pure `lib/gps`; no D1, migration, API or lesson change; nothing uploaded). Delivered / not-done list: `docs/superpowers/specs/2026-10-13-gps-tracking-design.md` §8-§9. Reviewed per Handbook §2 L2 (PASS, 7 Minors fixed).

**Side task (dot / Tony "keep iterating", 2026-10-16):** `chore/manifest-colours` (draft PR #86) — the installed app's
`app/manifest.ts` colours move to the light tokens (`--paper` #f6f3eb, `--navy` #0b1b2b); `tests/manifest-colours.test.ts`
keeps manifest, stylesheet and `/gps` manifest in step; `scripts/qa-browser/manifest.mjs` checks both manifests as served
(content type, colours, icon, links, theme-color metas) at phone + iPad widths, light + dark. Tier recorded: **L2
presentation-only** (author "L1/L2", reviewer L2 under the §2 doubt rule). No data, schema, contract or permission change.
Draft, not merged; needs Tony's go. Unlocated: the first full unit run was 762/763 (name not captured; 7 later runs clean).

**Next Recommended Task:** Tony's real-phone drive (phase 1b) on Staging
`/gps` from the Home Screen — Real GPS, 20-30 min with a 5 min screen lock and 5 min in another app, copy the
summary + feasibility JSON back; the verdict decides web vs native shell. Then phase 2 (lesson hook-in,
`lesson_tracks` migration, consent record, 90-day Cron, R10 line) only on Tony's separate approval (new table =
ALWAYS-ASK 1). PR #83 (learner form + Transfer / Archive in "More") is merged to `staging` (bc1e0cb) and awaits Tony's phone
check + Production release. Still queued: intake P4 (iOS Scan Text + local parser), `docs/tasks` memory scheme,
`scripts/check-signature-row-limits.mjs` on Staging D1.

**Waiting on Other Repo:** ACTGDS: notify-tick waits for Website PR #47 rework and Tony's explicit approval of the
new endpoint + secret (Production stays OFF). Nothing blocks this repo.

**Side task (dot / Tony, 2026-10-16):** `feature/gps-earlier-summaries` — `/gps` "Earlier recordings": the newest five rows show
one line (`16.99 km · Recorded 27.1 min · Coverage 97.4%`), the Results card's own numbers via `lib/gps/format.ts`: a read-only
in-memory projection (`lib/gps/earlier.ts`, existing `summarizeTrack`; a malformed record degrades alone). No capture, write,
consent, lesson, API or location change. Tier L2. Draft PR #87 to `staging`.

**Tony Manual Action Required:** none for this step. Later: the phase-1b real-phone drive; approve the consent
wording (design §6) and the `lesson_tracks` table before phase 2. Optional, still open: hide the ACT
"Jerrabomberra" district in Address suggestions; the 30-minute tooling checklist.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare Workers
Builds skip them. Simulate the Workers Builds command locally before merging (see STATUS.md CI).
