# P4 — GPS Tracking V1: design (living document)

_2026-10-13 · supersedes the spike note `docs/GPS_PWA_FEASIBILITY.md` (branch `experiment/gps-pwa-feasibility`, commit
`6d90816`, never merged). Roadmap: `docs/ECOSYSTEM_ROADMAP.md` P4/P5; backlog item 9. Decisions in §7 are Tony's
(2026-10-13); everything else is the agent's design and changes only through this file._

## 1. Goal

While the learner drives, the instructor's phone quietly records the car's track. At **End Lesson** the phone itself
computes distance, moving / stopped time, stops and (later) the junctions and signs passed, and keeps only a few KB
of **summary + special points** with the lesson, for the instructor and that learner to look back on. Nothing goes to
the Website in V1, nothing costs money, nothing distracts the instructor (CoP 5 f: phone handling ≤ 30 s, parked).

## 2. Hard limits (iPhone web)

- Safari / Home-Screen PWA pages receive location **only in the foreground with the screen on**. Lock the screen or
  switch apps and `watchPosition` stops until the page is back (WebKit bug 193946; no background geolocation for web).
- The workaround is to keep the screen on: Screen Wake Lock (iOS Safari 16.4+; fixed in Home-Screen apps from iOS
  18.4). Tony's iPhone runs iOS 26.2.1. A car charger and a holder are prerequisites; otherwise do not record.
- A web page has no reliable harsh-braking detection (DeviceMotion needs a tap-to-allow, ~6 Hz, holder shake). V1
  only flags "possible hard deceleration" from GPS speed, marked experimental; real accelerometer work is P5 / native.
- Because there is no background, a V1 track covers "screen-on time" only; the summary must say honestly "recorded
  73 of 80 minutes" (coverage).

Options weighed (A web + Wake Lock, B same as Home-Screen PWA, C native shell with background geolocation, D import a
third-party GPX, E phone timelines): **A/B is V1**; C is re-evaluated in P5; D sends learner location through a
third party (ALWAYS-ASK 7); E has no export.

## 3. V1 flow (target, not yet built)

All computation on the phone; the server receives results only. No new in-lesson taps:

1. **Start Lesson**: if this learner has consented (§6) and the device supports it, start `watchPosition`
   (high accuracy) and request a Wake Lock; black/navy status line "Recording · 00:42 · 12.3 km", no map. Fixes go to
   IndexedDB first (time, lat, lon, speed, accuracy). **Pause / Resume** for a break (no reads while paused).
2. **End Lesson**: stop, release the lock, compute on the phone: distance (shown beside the odometer km, never replacing
   it — the odometer stays official), moving time (> 5 km/h), stopped time, stops (≥ 3 s), max speed, coverage;
   special points (stops, signs, turns ≥ 60°, possible hard decelerations); town-centre entry for R10 (§5).
3. **Save**: with the lesson, a ≤ 10 KB `track_summary` JSON + `special_points` (≤ ~60) + optional simplified polyline
   (Douglas-Peucker 10 m, Google polyline, 2–5 KB). Best-effort like the ACTGDS integration: a failed track never
   blocks the lesson save.
4. The raw 1 Hz track stays on the phone and is deleted after a successful upload (or kept 7 days for debugging —
   Tony to decide).

Road features (free, offline): a one-off export of ACT open data (traffic-signal sites, pedestrian crossings, sign
blades) merged with OpenStreetMap (`highway=stop/give_way/traffic_signals/crossing`, `junction=roundabout`) into a
static `public/data/act-road-features.json`, like `streets-aug26.json`; "passed" = within 15 m with matching heading
(stop signs also need speed < 3 km/h). Always "GPS suggests …" in amber, never a judgement. No map-matching and no
map tiles in V1 (public OSRM / OSM tiles forbid product use; Google Roads is paid); a plain SVG of the simplified track
and a "Export KML" button for Google Earth.

New table (one additive migration, **needs Tony's separate approval**): `lesson_tracks` (`lesson_id` PK/FK,
`instructor_id`, `summary_json`, `special_points_json`, `polyline` nullable, `coverage_seconds`, `consent_version`,
`created_at`, `expires_at`). It replaces the deferred `lesson_route_checks` of the C23 route design; R10's location +
comment line is unchanged.

## 4. Storage and cost

Per lesson today 30–260 KB (two signature PNGs); the GPS adds 1–4 KB summary + 2–5 KB polyline. Cloudflare free
tier (D1 500 MB / database, 5 GB / account; Workers 100 k requests / day, 10 ms CPU; R2 10 GB) is enough for thousands
of lessons: **V1 needs no paid plan**. Computing on the phone also keeps the Worker under the 10 ms CPU limit. A paid
plan or R2 is only for keeping raw tracks long-term (ALWAYS-ASK 1, ask then).

## 5. Power and data

- Record only during a lesson (Start → End); not without consent or (ask) without a charger.
- The screen is the big consumer: dark UI (OLED), low brightness, car charger. GPS at 1 Hz is estimated 4–8 % / h,
  screen-on another 10–15 % / h — the real-phone test records start / end battery.
- `enableHighAccuracy: true`, every callback recorded, fixes with accuracy > 30 m discarded for geometry (the code
  uses 50 m until the real test says otherwise); no down-sampling (stops and signs need 1 Hz); fall back to a 2 s
  cadence above 60 km/h if drain is too high.
- Zero mobile data during the lesson (no map, no server); ≤ 10 KB after it; the road-feature file is cached once.
- Resilience: flush to IndexedDB every 2 s / 20 fixes; a killed page is recovered on the next open ("interrupted
  recording"), closed at its last sign of life.
- R10 link: a new amber suggestion line on Competency 23 ("GPS suggests (Woden, coverage 95 %): stop signs 1, give
  way 2, lights 3 … tap to adopt") that pre-ticks the route chips; the instructor can still change them. Town-centre
  polygons are drawn once from OSM and **checked by Tony on a map** before entry detection is enabled. Nothing is
  sent to ACTGDS (contract hash unchanged).

## 6. Privacy and consent

A location track is personal information (the start is usually the learner's home): ALWAYS-ASK 1 (new table), 6
(new data class, later a new audience on the Website), 7 (any third-party map / matching service), 12 (consent
wording). V1 uses no third party.

- **Who sees it**: V1 only the lesson's own instructor (owner-only rule). The learner sees it on the Website only in
  P5 via a contract change (ALWAYS-ASK 5, both repos in lockstep). Admin / other instructors: no.
- **Retention**: summary numbers stay with the lesson (CoP 9.3, ≥ 12 months); special points + simplified polyline
  are cleared after **90 days** by Cron (`expires_at`); the raw 1 Hz track is never uploaded.
- **Start / end trimming**: points within 150 m of the first and last fix are removed from any point list that could
  be shown or exported; the distance still counts the whole drive. Default **on**.
- **Minors**: OAIC guidance presumes capacity to consent from 15; an ACT learner licence needs 15 years 9 months, so
  the learner's own consent suffices (Tony, §7.3) — no parent flow. Recorded per learner as `gps_consent` (version,
  date, who); withdrawable at any time, withdrawal stops recording.
- **Consent wording (bilingual draft; Tony reviews the final text before it ships, ALWAYS-ASK 12)**: "ACT Golden
  Driving School records the car's position on the instructor's phone during your driving lesson to work out
  distance, moving and stopped time and the junctions and signs you passed, to help review your lesson. Only your
  instructor and you can see it; it is not given to anyone else. The detailed track is deleted after 90 days; the
  summary numbers stay with your lesson record. You can withdraw consent at any time." The PDF prints one GPS summary
  line, never a track.

## 7. Tony's decisions (2026-10-13)

1. V1 = A/B (web + screen on + car charger; locked screen stops recording); native shell re-evaluated in P5.
2. Retention: summary permanent with the lesson; special points + polyline 90 days; raw 1 Hz never uploaded.
3. Consent from the learner only (no parent flow); the §6 bilingual draft as written, final text reviewed by Tony.
4. 150 m start/end trimming on by default; the PDF prints one GPS summary line.
5. "Waylo" (wayloahead.com, launching soon) is a learner / supervisor app, not an instructor tool; its "gap analysis
   of road types driven" is worth borrowing in P5.
6. Models: strongest for design, rules and data code; a lighter one for mechanical steps.

## 8. Phases

| Phase | Content | Tony decides |
|---|---|---|
| 0 design | this document | §7 (done) |
| **1 isolated recorder (this step, DONE on `feature/gps-p4-recorder`)** | `/gps` page + `lib/gps`, synthetic closed loop, device-local only | nothing; see §9 |
| 1b real-phone test (Tony, in Australia) | `/gps` on Staging, Real GPS source, one 20–30 min drive with a 5 min screen lock and 5 min in another app; copy the summary + feasibility JSON back | continue web, or native shell |
| 2 V1 | Start/End Lesson hook-in, `lesson_tracks` migration (Staging first), `gps_consent`, lesson-detail summary card + SVG track, 90-day Cron, R10 suggestion line, tests + qa-browser on synthetic tracks | consent text; retention; trimming switch; PDF line; separate Production authorization |
| 3 P5 | roundabouts / T-junctions / speed zones / motorway ramps, cumulative road network per learner, map (PMTiles on R2), summary into the V1 contract for "My Driving" | contract change; map; paid plan / R2; native shell |

Each phase stops and reports (AGENTS.md §11).

## 9. What this step (phase 1) delivers and what it does NOT

**Delivered (L2, isolated: no D1, no migration, no API, no change to lessons; nothing imports `lib/gps` from
`app/driver-app.tsx` or `lib/repo.ts`):**

| Piece | Where |
|---|---|
| Recorder: `watchPosition`, Wake Lock, visibility + Page Lifecycle (`freeze` / `lifecycle_resume`), 10 s heartbeat (also while paused: the page-alive signal), 2 s / 20-fix flush, **Pause / Resume**, Stop from either, crash recovery (an open pause closes at the last sign of life) | `lib/gps/recorder.ts` |
| Device-local store (IndexedDB `ia-gps`; memory twin; fault-injecting wrapper), `clearAll()` | `lib/gps/store.ts` |
| Feasibility analysis (gaps, coverage, screen-on vs hidden, JS suspension, late delivery, jumps, accuracy, wake-lock held %, **PWA-vs-native verdict**), pauses excluded from coverage and gap detection | `lib/gps/analysis.ts` |
| **Track summary** (pure, numbers only): distance (accuracy ≤ 50 m, jumps skipped, gaps and pauses not credited), moving / stopped time (speed > 5 km/h, implied when the device gives none), stops (≥ 3 s under 1 m/s), max speed, coverage %, gaps, paused time, 150 m trimming counts; `specialPoints` reserved and always empty | `lib/gps/summary.ts` |
| Synthetic drive profile (stops, outage, missing speed, GPS jump) and `syntheticDriver` — a `GeoLike` replay at accelerated wall-clock speed with its own clock for the recorder and on-demand geo-error injection | `lib/gps/synthetic.ts` |
| Page `/gps` (noindex, not in the app's navigation, own manifest scoped to `/gps`): Synthetic drive (default) / Real GPS behind a per-session consent box that is never persisted; Start / Pause / Resume / Stop / Clear this device; live status; Results card + folded feasibility report; Copy / Download summary JSON; interrupted recovery; earlier recordings | `app/gps/` |
| Tests (43, synthetic only) and browser QA (`scripts/qa-browser/gps.mjs`, 182 checks at 375 / 820 px, light / dark) proving the closed loop, the consent gate, that the synthetic flow never calls `navigator.geolocation`, and that the exported JSON carries no coordinates | `tests/gps-*.test.ts`, `scripts/qa-browser/` |

**Not done (by design of this step):** no lesson integration (Start / End Lesson untouched), no upload or sync, no
`lesson_tracks` table or migration, no consent record (`gps_consent`), no road features / R10 line, no polyline or
KML export, no PDF line, no map. A **synthetic PASS is not evidence of iPhone background-GPS behaviour**: the verdict
in the feasibility report only means something on the real-phone test (phase 1b), on HTTPS, from the Home Screen.

Decision criteria for phase 1b (computed by `analyzeSession`, `CRITERIA`; a gap is > 15 s without a fix, pauses
excluded): **PWA_VIABLE** = screen-on coverage ≥ 98 %, no screen-on gap > 20 s, p95 interval ≤ 10 s, and hidden
coverage ≥ 95 % with no hidden gap > 30 s, on ≥ 20 min recording with ≥ 60 s hidden → continue on the web (repeat on
2–3 drives). **FOREGROUND_ONLY** → the web cannot keep a complete trace in normal use; decide native shell vs
"screen-on only" V1. **NATIVE_REQUIRED** → native. **INCONCLUSIVE** → re-run. Supporting signals: frozen periods,
late-delivered fixes, wake-lock held %, accuracy, jumps, storage errors, battery start / end (noted by hand).

## Sources

WebKit 193946 (no web background geolocation); caniuse Screen Wake Lock; WebKit 254545 / Progressier (PWA Wake Lock
fixed iOS 18.4); App Store 2.5.4 background-location rejections; ACT open data (traffic-signal sites, pedestrian
crossings, sign blades); Overpass / OSRM / OSMF usage policies; Cloudflare Workers / D1 / R2 pricing; OAIC children
and young people; Children's Online Privacy Code exposure draft (2026); Google Maps Platform pricing; Protomaps.
Unverified: iOS 18.4 PWA Wake Lock fix (third-party note), 1 Hz battery drain, Canberra OSM sign completeness,
whether R2 free tier needs a payment method, whether the ACT has an official digital logbook app.
