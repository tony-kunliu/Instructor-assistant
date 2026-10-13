# Backlog

_Last updated: 2026-10-13. Not an authorization: every item still needs Tony's
go-ahead and ends with a stop (AGENTS.md §11). The longer-term two-repo
direction is in `docs/ECOSYSTEM_ROADMAP.md` (P1–P6)._

## Planned order (agreed with Tony 2026-10-10)

Direction, not an authorization: each item still needs Tony's go-ahead and
ends with a stop (AGENTS.md §11).

Near term (Instructor Assistant only, low risk):
1. DONE (Production 2026-10-11): learner management 3a (missing-PDF-details
   marker, duplicate licence warning incl. archived) and 3b (archive reason and
   restore history, migration 0010).
2. (done, see 1)
3. 3c: transfer a learner to another instructor. **T1 DONE (Production
   2026-10-11, release #12, migration 0011)**; T2 (PDF "lessons by instructor" line, multi-transfer
   list, Issue #3 info post) next on Tony's go:
   `docs/superpowers/specs/2026-10-11-learner-transfer-design.md` (migration
   0011, additive; no ACTGDS event).
- iPad layout: **DONE (Production 2026-10-12, release #13; accepted by Tony on a
  real iPad)**. Responsive CSS only
  (≥700px wider column and 44px+ targets, ≥1000px two columns via grid
  placement, DOM order unchanged; phones in landscape keep the phone layout),
  signature pads use a fixed 640×320 PNG (2:1, scaled by CSS; server limit
  700k chars with a distinct 'too large' error),
  qa-browser section 16. Still open: run `scripts/check-signature-row-limits.mjs`
  against Staging D1 (never Production) to prove the two-signature row on real D1.

Medium term (new features; confirm rules with Tony before building):
4. Competency 23 route suggestions and route check (R10). **R10a DONE
   (Production 2026-10-12, release #14; no migration; tested on Staging by Tony)**: suggestion line (home
   district from the address), route check group stored in location + one
   comment line, nothing to ACTGDS:
   `docs/superpowers/specs/2026-10-11-competency-23-route-design.md`.
   Left for later: Fyshwick / Russell / Capital Hill residents get the grey
   "not in the district table" line (instructor decides); P4 GPS counting.
5. Remove-the-"A"-condition reminder after 12 months (R8, CoP 9.4).
6. Certificate number records (R9, CoP 9.3, 10 f).
6a. Learner intake (Tony's 4 requests, 2026-10-11): address suggestions
   from a bundled G-NAF street index, overseas/interstate licence fields
   (school rule confirmed by Tony: interstate learner time counts; interstate
   or overseas FULL licence held 12 months removes the wait; overseas learner
   does not count), "Competency 23 eligible from" with the PDF Eligibility box
   auto-filled (never overwriting Tony's text), iOS Scan Text + local parser.
   **P1 DONE (Production, release #12); P2 DONE (Production, release #13,
   migration 0012; iOS Scan Text / list-vs-keyboard reported OK by Tony on
   Staging); P3 DONE on branch `feature/intake-p3-licence` (migration 0013,
   strict review + Staging D1 Migrate before merge); P4 (iOS Scan Text + local
   parser) on Tony's go**:
   `docs/superpowers/specs/2026-10-11-learner-intake-design.md` (P3 additive
   columns; free options only, AI scan not planned; nothing to ACTGDS).

Long term (ecosystem, coordinated with Work on actgds.com Issue #3):
7. P2 lesson notification emails: the notify-tick waits for Website PR #47
   rework and Tony's explicit approval of the new endpoint + secret
   (`AGENTS.md` §14 exclusion; Production stays OFF). IA-side caller spec only
   once the Website confirms the endpoint (Handbook §14 follow-up d).
8. P3 bookings into Today's Lessons (Cal.com).
9. P4 GPS tracking, then P5 drive intelligence. New storage = new
   infrastructure: needs Tony's separate approval; design first. Revisit when
   Tony is back in Australia with real learner data.
10. P6 driving journey across licence stages and both systems.

## Designed, waiting for a go

| Item | Where designed | Status |
|---|---|---|
| Learner edit, Phase 1 (name, address, phone, licence, ...) | `docs/superpowers/specs/2026-10-08-learner-management-plan.md` | **DONE** (in Production, migration 0008). |
| Learner data for assessment rules, Phase 2 (licence issue date, HPT, logged hours) | same plan; design: `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md` | **DONE** (in Production, migration 0009). |
| Assessment-rules reminders (never blockers): 36 h gates (R1), Competency 23 eligibility (R2) and hours window (R3), ADI Audit online booking link (R4), learner licence validity (R5) | `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md` | **DONE** (in Production 2026-10-10, run 38044255328): R1, R2, R3, R5 and the booking link. |
| Learner management, Phase 3a: missing-details marker, duplicate licence warning (reminders only, client-side) | learner management plan | **DONE** (in Production, release 2026-10-11). |
| Learner management, Phase 3b: archive reason and restore history | learner management plan (Phase 3) | **DONE** (in Production, migration 0010): optional preset reason + note, History in the archived banner. |
| Learner management, Phase 3c: transfer a learner to another instructor (incl. the CoP 9.1 h / 9.2 e previous-records reminder, R12) | `docs/superpowers/specs/2026-10-11-learner-transfer-design.md` | T1 **DONE** (in Production, release #12, migration 0011). T2 waits for Tony's go. |
| Competency 23 route suggestions and route check (R10) | `docs/superpowers/specs/2026-10-11-competency-23-route-design.md` | R10a **DONE** (in Production, release #14; no migration): D3-D10 (suggestion line, route group, location + comment line, parse-back in History Edit). P4 GPS counting waits for a separate approval. |
| Learner intake: address suggestions, overseas/interstate licence, Competency 23 "eligible from", licence scan | `docs/superpowers/specs/2026-10-11-learner-intake-design.md` | Q1-Q11 decided by Tony 2026-10-11 (free options only; AI scan not planned). P1 and P2 DONE (below); P3/P4 wait for a go. |
| Learner intake P1: "Competency 23 from" date + PDF Eligibility auto-fill (D17-D18) | `docs/superpowers/specs/2026-10-11-learner-intake-design.md` (branch `docs/learner-intake-design`) | **DONE** (in Production, release #12; no migration). |
| Learner intake P2: address suggestions from the bundled G-NAF street index, structured suburb/state/postcode (D1-D10, D23) | same design | **DONE** (in Production, release #13, migration `0012` on Staging and Production): `scripts/build-street-index.mjs`, `public/data/streets-aug26.json`, listbox UI, qa-browser section 18. |
| Learner intake P3: overseas / interstate licence fields + school rule in R2 / "Competency 23 from" (D11-D14, D17) | same design | **DONE on branch `feature/intake-p3-licence`** (migration `0013`, six nullable columns; `lib/other-licence.ts`; qa-browser section 23). Needs the strict independent review and `Staging D1 Migrate` before merge. Follow-ups: (1) an interstate learner licence issued after the ACT licence is counted literally from its own date (spec D13 a) — confirm with Tony or count from the earlier date; (2) the D13 (e) grey line is a separate `r2-other` reminder under R2; (3) the country `<datalist>` is a bundled English list (`COUNTRIES`), free text saves; (4) spec D14 "revision labels are added" is stale: there is no learner History UI yet (learner_revisions are stored, not displayed), so no labels exist to add — update the spec when that UI is designed. Review 2026-10-13: Tony decided count from the EARLIER issued licence, keep the separate grey `r2-other` line, keep the country list. P4 scan waits for a go. |

## Learner list UI (concept approved by Tony 2026-10-12; branch `feature/ui-learner-list`)

- DONE on the branch (awaiting review/merge): shared CSS tokens in `app/globals.css`
  (website navy/gold/warm paper, light + dark), navy top bar with "+ New learner", search,
  Mine / All / Archived with counts, glance line, one card per learner (initials, transmission ·
  stage · lessons · hours, 22-segment bar of the achieved competencies, Review 1-17 / Review
  1-22 / Final Drive 23 chips from `computeProgress`, "C23 from" and licence-expiry chips from
  `lib/rules.ts`). Data: `lib/repo.ts#listLearnerSummaries`, ONE set-based statement
  (lessons aggregate + json_group_array of assessed events per learner), 0 binds; the list GET is
  2 statements; `tests/learner-list-summaries.test.ts`, `tests/learner-card.test.ts`, budget test,
  qa-browser section 20 (375px light/dark, 820px two columns).
- Extras beyond the concept for Tony to confirm (review M7-M9): global reduced-motion rule,
  `--font-ui` stack (adds "PingFang SC"), the glance line, the "Instructor <name>" chip in All /
  Archived, the C23-from and licence-expiry chips, the collapsed list + "Show all learners".
- Lesson record redesign (branch `feature/ui-lesson-record`, concept screen A approved 2026-10-12,
  Tony's decisions: number-only chips; Save only after End Lesson; Transfer/Archive stay where they
  are for now): done on the branch. Follow-ups from it: (1) concept screen B — learner form in
  Student / Address / Licence sections with Transfer and Archive folded into a "More" section of the
  EDIT form (separate task, Tony's decision 3); (2) the History panel and the learner form got
  colour harmonisation only (legacy tokens now alias the shared ones), their layout is unchanged;
  (3) the progress card still repeats the header's segments/gates (kept for its legend, invalidation
  warning and Completed banner) — fold or drop it only on Tony's say-so.
- Appearance + "only the form" (PR #77 merged to `staging`; Tony's follow-up on branch
  `feature/ui-theme-toggle-top`, 2026-10-13): the control is now one icon button in the top bar that
  toggles Light <-> Dark (first state follows the phone). Follow-ups: (1) `app/manifest.ts`
  `background_color` / `theme_color` still pre-redesign (PWA splash only); (2) the toggle's name is
  English only, like the rest of the UI; (3) there is no way back to "follow the phone" after a tap
  short of clearing site data — add one only if Tony asks.
- Follow-ups: the concept's "36 h not yet logged" chip was NOT built
  (R1 needs each learner's lessons, not in the list payload); "Instructor <name>" chip shows
  only in All / Archived; the list collapses to the open learner's card ("Show all learners")
  so the lesson form stays one scroll away on a phone.

## Minor follow-ups (bundle into the next feature)

- After a milestone has become invalid, every later edit of that lesson (even comment-only) repeats the 'No longer valid' message; report only when the status changed (lib/repo.ts recordedHere).

- Progress-invalidation fix (`fix/progress-invalidation`): before release,
  run `scripts/audit-progress.mjs` on a read-only Production export to list
  learners whose milestones change under the lesson-order rule. Reply to
  Work on Issue #3 once merged.

- Archiving an already-archived learner with a reason (two devices) returns 200 and drops the reason silently; consider a message.

- No message when a learner is archived while the edit form is open.
- The unmounted-key QA check for the PDF button is weak.
- Learner intake P1: the exact text `C23 from YYYY-MM-DD` (optionally `~`) is reserved for the app; hand-typed identical text is treated as generated and refreshed (documented in `lib/c23-eligibility.ts`; no behaviour change planned).
- Learner intake P1: "Missing for the PDF: Eligibility" still shows for an empty stored value even when the PDF will print the auto-filled `C23 from …`; consider counting a computable value as present.
- 3c T1 transfer: the compare-and-set guard does not re-check the inactive-owner exception (an owner
  re-activated between the read and the batch still loses the learner to a colleague); add the
  owner-status condition to the guard if this ever matters.
- 3c T1 transfer (review L5): `listLearners` ships every transfer event, notes included, for every
  learner (unbounded by design; tiny today). If it grows, send only the latest event in the list and
  the full history with the detail.

## Not designed yet

- Remove the "A" condition in the first 12 months: Review 2 drive in a manual
  vehicle, with ADI Audit notified beforehand (R8, CoP 9.4).
- Certificate numbers: a field per issued certificate, issued in ascending
  number order, copies kept (R9, CoP 9.3, 10 f).
- Instructor phone use during a lesson ≤ 30 seconds: keep in-lesson actions to
  one or two taps; details after the lesson (R11, UX principle, CoP 5 f).
- Learners arriving from an ADI outside the school (paper import with
  prior-instructor rows): the same "check the previous records, tell ADI Audit"
  reminder as the 3c design D7 could be shown after import (R12, CoP 9.1 h /
  9.2 e). Not designed; a note until Tony asks.
- Emails and promotion consent: stay in the ACTGDS CRM only, never stored in
  Instructor Assistant. A consent design and a registration form are ACTGDS work
  and are deferred.
- Paper import for further learners: the tooling is live in Production
  (migration 0006); waiting for paper records from Tony.
- A read-only check on Production for lessons recorded before Access identity
  existed (their owner falls back to the learner's instructor). Tony believes
  there are none.
- Every October: add the next year's ACT public holidays to
  `lib/act-public-holidays.ts` (procedure in its header) and append the year to
  `COVERED_YEARS`; until then dates outside 2026-2027 show "not loaded; check
  manually". Cross-check the 2026-2027 table against the ACT Government
  public-holidays page, which returned HTTP 403 to the build environment.
- History markers for past reviews done inside 36 h (rules-reminders spec, later).
- **Yearly (every October, with the public holidays): rebuild the G-NAF street
  index** for the learner Address suggestions (new streets in new suburbs, e.g.
  Whitlam, Sulman): `NODE_USE_ENV_PROXY=1 node scripts/build-street-index.mjs`
  (range-reads only the needed PSV files from the current national ZIP on
  data.gov.au; ~200 MB download, nothing stored), then update
  `STREET_INDEX_FILE` in `lib/address-suggest.ts` to the new release name,
  run `npm test` (shape + real-data assertions) and commit the new
  `public/data/streets-<release>.json` (the old one is removed by the build).
  Built 2026-10-12 from the Aug 2026 release (7,928 entries, 146 localities).
  Known data quirks to revisit (review 2026-10-12, not bugs): G-NAF has a
  "Jerrabomberra ACT 2600" locality (the district) as well as Jerrabomberra NSW
  2619, so an "… jerra" suburb prefix ranks the ACT one first (D4: ACT before
  NSW); "Belconnen" appears twice (2615 and 2617, one row per postcode); a few
  streets have the type inside the name with an empty type ("The Pines
  Avenue", "The Valley Avenue", "The Causeway", "Emu Bank") and are shown as
  named. Decide with Tony whether to hide the ACT Jerrabomberra district.

## Process and tooling (not product)

- `docs/tasks/` memory scheme + Memory Guard changes (`docs/OPERATING_HANDBOOK.md`
  §9, §14 follow-up b): not started; until then keep editing STATUS/TASK/BACKLOG.
- `tests/pdf-export-font-subset.test.ts` leaves a `/tmp/font-subset-*` dir (~14 MB)
  per run; clean it up in the test.
- Tony's optional 30-minute tooling checklist (not done yet): GitHub Dependabot
  alerts + push protection, merge the duplicate GitHub environments, claude.ai
  plugins (Security Guidance, claude-security, Cloudflare read-only).

## Ecosystem phases (see the roadmap)

- P1 Student Account: ACTGDS side ("My Driving"); is live in Production.
- P2 Lesson notification emails, P3 Cal.com booking into Today's Lessons, P4 GPS
  tracking, P5 Drive intelligence, P6 Driving journey: not started.
