# TASK.md

_Last updated: 2026-10-16_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** P4 GPS phase 1 — isolated, default-OFF GPS recorder, branch `feature/gps-p4-recorder` —
**Merged to `staging` (PR #84, 62923cf) and deployed to Staging by Workers Builds (L2 isolated: new page + pure libraries; no D1, no migration, no API, no lesson change;
nothing uploaded).** Design + delivered / not-done list: `docs/superpowers/specs/2026-10-13-gps-tracking-design.md`
§8-§9. Delivered: `lib/gps` (recorder with Pause / Resume and crash recovery, pause-aware feasibility analysis
with the PWA-vs-native verdict, pure `summarizeTrack` with 150 m trimming and no coordinates, synthetic drive +
accelerated `syntheticDriver`, IndexedDB `ia-gps`); page `/gps` (Synthetic drive default, Real GPS only behind a
per-session, never-persisted consent box; Start / Pause / Resume / Stop / Clear this device; Results card; folded
feasibility report; Copy / Download summary JSON; not linked, noindex, own manifest); 43 unit tests (synthetic
only); `scripts/qa-browser/gps.mjs` (182 checks, 375 / 820 px, light / dark, `watchPosition` spied: never called
by the synthetic flow, once in Real GPS mode). Prior spike `experiment/gps-pwa-feasibility` reused, not merged.
Reviewed per Handbook §2 L2: one independent review (PASS, 7 Minors fixed with a test / QA check each, verified by the merging agent).

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

**Tony Manual Action Required:** none for this step. Later: the phase-1b real-phone drive; approve the consent
wording (design §6) and the `lesson_tracks` table before phase 2. Optional, still open: hide the ACT
"Jerrabomberra" district in Address suggestions; the 30-minute tooling checklist.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare Workers
Builds skip them. Simulate the Workers Builds command locally before merging (see STATUS.md CI).
