# P4-A — GPS PWA Feasibility Spike

**Experiment branch `experiment/gps-pwa-feasibility` — not merged, not deployed.**
Answers one question from Issue #8: *can an iPhone Web/PWA keep a continuous GPS
trace through a real 60–120 min lesson (screen on, locked, other app in front)?*
Nothing here touches lessons, D1, migrations, Integration, P3 or ACTGDS.

## What was built (isolated)
| Piece | File |
|---|---|
| Harness page `/gps-lab` (own installable manifest, stats-only report) | `app/gps-lab/` |
| Recorder: `watchPosition`, Screen Wake Lock (re-acquire on return), visibility + `pagehide/pageshow/freeze/resume`, 10 s heartbeat, batched flush every 2 s / 20 fixes, crash recovery | `lib/gps-lab/recorder.ts` |
| Device-local append-only buffer (IndexedDB; in-memory twin for tests) | `lib/gps-lab/store.ts` |
| Pure analysis: gaps, coverage (screen-on vs hidden), JS-suspension, late delivery, jumps, accuracy, verdict | `lib/gps-lab/analysis.ts` |
| Synthetic drives | `lib/gps-lab/synthetic.ts` |

Key design choice — **heartbeats**: a timer event every 10 s. If heartbeats stop
while the page is hidden, iOS froze the page's JavaScript; if fixes stop but
heartbeats continue, the OS stopped delivering location. Those two failure modes
need different fixes, and only the combination tells them apart.
Fixes carry both the fix's own timestamp `t` and the callback time `rx`; a large
`rx − t` means the OS buffered fixes and delivered them late (good for recovery,
bad for live status).

## Automated evidence (Claude)
`npm test` (gps-lab-analysis / gps-lab-recorder: 21 tests), typecheck, build, and
`scripts/qa-browser/gps-lab.mjs` (Chromium at 375/390 px, emulated geolocation and
simulated visibility): fixes delivered, hidden/visible logged, reload mid-recording
→ recovery from IndexedDB, Start→Stop report, downloaded report has no coordinates,
permission-denied surfaced, no overflow, ≥44 px targets.

## What only a real iPhone can tell us
1. Does `watchPosition` keep delivering with the screen **locked**? with another app in front?
2. Is the page frozen (heartbeat gaps) and does it resume cleanly?
3. Does the Home-Screen (standalone) app behave differently from Safari?
4. Is Screen Wake Lock granted in standalone mode, and does it survive a lock/unlock?
5. Real accuracy, time-to-first-fix, battery drain, and the location-permission flow.
6. Whether fixes delivered late after a resume are complete (OS-buffered) or lost.
Emulation cannot answer any of these; it only proves the harness measures correctly.

## Minimum real test — one drive, ≈ 30 min
Prerequisite (separate authorization, not done here): the lab must be reachable
over HTTPS (geolocation needs a secure context) — e.g. this branch deployed to a
throwaway Worker behind its own Cloudflare Access app. It must **not** go through
Staging/Production.
1. Open `/gps-lab`, Add to Home Screen, open from the icon, allow location “While Using”.
2. Start recording; phone in a holder. **No phone interaction while moving** — a passenger/student (or a stop) for steps 3.
3. ~5 min in: lock the screen ~5 min. ~15 min in: another app (Maps) in front ~5 min. Screen on for the rest.
4. Parked: open the lab → Stop and get report (or Recover if the page was killed). Copy the report JSON (stats only, no coordinates).

## Decision criteria (PWA → native)
Computed by `analyzeSession` (`CRITERIA` in `analysis.ts`); a gap is > 15 s with no fix.
| Result | Condition | Decision |
|---|---|---|
| **PWA_VIABLE** | screen-on coverage ≥ 98 %, no screen-on gap > 20 s, p95 interval ≤ 10 s **and** hidden coverage ≥ 95 % with no hidden gap > 30 s, on a ≥ 20 min test with ≥ 60 s hidden | continue PWA (P4-B on web); repeat on 2–3 more drives before committing |
| **FOREGROUND_ONLY** | screen-on passes, hidden fails | PWA cannot keep a complete trace in normal use → **native shell** (Capacitor / Core Location), per Issue #8 — do not patch around browser limits |
| **NATIVE_REQUIRED** | screen-on fails (gaps/coverage/intervals) | native |
| **INCONCLUSIVE** | < 20 min, no hidden period ≥ 60 s, or no screen-on time | re-run |
Supporting signals (not verdict inputs): page-frozen periods, late-delivered fixes,
wake-lock held %, accuracy (median/p95, % > 50 m), GPS jumps, storage errors.
Even a PASS keeps the Issue #8 rule: exact traces are sensitive; retention/consent
design is required before any Production GPS.

## Limitations of this spike
Single-device, single-drive evidence; GPS distance is diagnostic only (odometer stays
official); no upload/sync/idempotency design (that is P4-B); no map (by design).
