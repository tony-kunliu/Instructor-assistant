# TASK.md

_Last updated: 2026-10-12_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** learner intake **P2** (address suggestions) — Completed on
`feature/intake-p2-address` (not pushed / not merged): migration `0012` (3 nullable address
columns), `scripts/build-street-index.mjs` + `public/data/streets-aug26.json` (G-NAF Aug 2026,
7,928 streets, 146 localities, 49 kB gz, attribution in footer/README), `lib/address-suggest.ts`
(D4 matching, D7 rules), listbox in the New/Edit learner form, qa-browser section 18. Nothing to
ACTGDS (payload keys asserted unchanged). D8 route hook deferred: R10a not on `staging` yet
(BACKLOG). 3c T1 (`feature/transfer-t1`, migration `0011`) is still reviewed and unmerged.

**Next Recommended Task:** independent code review of P2, then apply `0012` to Staging D1
(`Staging D1 Migrate`, `ref` = `feature/intake-p2-address`) BEFORE merging to `staging`
(same for `0011` / T1, in migration order 0011 then 0012). Then P3 (overseas/interstate licence)
or T2 / R10a, on Tony's go.

**Waiting on Other Repo:** ACTGDS: Work's display polish (list sent) and lesson
notification activation decisions. My Driving is live. Nothing blocks this repo.

**Tony Manual Action Required:** after P2 is on Staging, on the real iPhone: tap the Address
field, confirm iOS "Scan Text" still appears in the callout, type `44 app` and check the list is
not hidden behind the keyboard (Access identity and iOS keyboard cannot be simulated). After T1 is
on Staging, one real-login transfer and transfer-back of a `QA …` learner.

**Docs in flight:** `docs/operating-handbook` branch — Operating Handbook v2
(`docs/OPERATING_HANDBOOK.md`, approved by Tony 2026-10-12; §14 records his 10 decisions and
the follow-up tasks: docs/tasks memory scheme, cross-model review, notify caller spec). Docs only.

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`,
`ci.yml` only); Cloudflare Workers Builds skip them. Simulate the Workers
Builds command locally before merging (see STATUS.md CI).
