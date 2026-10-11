# Competency 23 route suggestions and route check (R10) — design

_Date: 2026-10-11 · Status: **DESIGNED, waiting for Tony's go** (no code yet) ·
Based on `origin/staging` 87f328b · Builds on the reminders engine in
`docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md`
(D1 "reminders never block", D4 "pure functions, zero D1")._

## 1. What the instruments require (verbatim)

Read with `pdftotext -layout` from NI2020-703 (38 pages) and DI2020-294
(14 pages), the copies in the session scratchpad. Page = PDF page (NI2020-703's
printed page numbers match).

| # | Requirement | Source |
|---|---|---|
| I1 | Title: "DRIVING ON BUSY ROADS AND UNFAMILIAR ROADS". Performance: "safe, controlled and efficient driving on busy roads and unfamiliar roads." Conditions: "Wide variety of different road and traffic situations." | NI2020-703 Sch 1, Competency 23, p 36 |
| I2 | "The student will drive the vehicle in heavy traffic flow conditions and in unfamiliar areas." | p 36, Requirements |
| I3 | "Note: An assessment must be conducted to include 2 designated zones (a designated zone is a zone as approved by the RTA)." | p 36 |
| I4 | "The student must negotiate the following in an UNFAMILIAR Town Centre within ONE (1) zone which includes: • 1 stop sign; • 1 give way sign; • 2 traffic lights; • 2 pedestrian crossings; • minimum of five (5) right and five (5) left turns." | pp 36-37 |
| I5 | "The accepted Town Centres are: Canberra City (Civic); Gungahlin; Belconnen; Woden; Tuggeranong; Fyshwick; Manuka and Kingston – together." | p 37 |
| I6 | "Accepted Town Centres are those which are bounded by the streets listed below. A Competency 23 assessment can only be undertaken within and including the streets listed." Followed by a street table per centre ("RTA - Accepted Town Centres"). | p 37 |
| I7 | "The student will be required to perform the tasks continually throughout a single lesson unaided by the instructor." Then 11 "will demonstrate" items (controls, lane position, keep left, ≥ 3 s following distance, near the posted limit, concentration, road rules, hazards, system of vehicle control, any competency, courtesy). | p 38 |
| I8 | "90% compliance is required except for road rules, which require 100% compliance." "No automated/assisted reverse parking permitted. Use of rearview cameras is permitted." | p 38 |
| I9 | Eligibility, Review 2 first, hours window (already R2/R3). | p 36 |
| C1 | "must provide driver assessment in accordance with the assessment standards, including the requirements set out in the assessment standards for the competency 23 assessment". | CoP 9.2 f, p 11 |
| C2 | "Before beginning a review … or the competency 23 driving assessment, the driving instructor must provide the student with an overview of the process and what is expected." | CoP 9.2 j, p 11 |
| C3 | "must focus solely on the task of driver instruction or driver assessment … must not read documentation or other material or operate items or equipment not relevant to the lesson. However, the use of mobile phones or two-way radios by the driving instructor for a period not exceeding 30 seconds is acceptable." | CoP 5 f, p 6 |

Street table as printed (p 37), kept verbatim including its spelling and
repeats: Canberra City: Barry Dr, Marcus Clarke St, Edinburgh Ave, London Cct,
Constitution Ave, Coranderrk St / Cooyong St. Gungahlin: "Gunghalin Dr", The
Valley Ave, Kate Crace St / Tesselaar St, Swain St, Pallin St, Gundaroo Dr.
Belconnen: Coulter Dr, Nettlefold St (including Courts off Nettlefold), College
St, Eastern Valley Way, Emu Bank, Bissell St, Joynton Smith Dr, Emu Bank, Luxton
St. Woden: Melrose Dr, Launceston St, Callam St, Hindmarsh Dr. Tuggeranong:
"Athllon Dr", Anketell St, Colishaw St, North Reed St / South Reed St, Anketell
St. Fyshwick: Canberra Ave, Newcastle St, Collie St / Tennant St, Gladstone St,
Newcastle St, Ipswich St. Manuka: Canberra Ave, Captain Cook Cres, Murray St,
Furneaux St. Kingston: Eyre St, Jardine St, Giles St, Kennedy St.

### Not in the instruments (do not invent)

- **"Unfamiliar"** is not defined: no rule for how the instructor decides a town centre is unfamiliar to the student.
- **"Designated zones"** (I3): only "approved by the RTA"; neither instrument lists them. Whether the 7 town centres are the zones, and what the second zone must be, is not stated.
- No route length, duration, distance, speed zones, roundabout count or lane-change count for Competency 23 (those exist for Competency 7, 8 and the Reviews, not here).
- Stop sign, give way, lights and crossings say "1"/"2" without "minimum"; only the turns say "minimum". The app treats all five as minimums (**assumption A1**).
- Whether the turns must all be inside the town centre: I4 lists them under "within ONE (1) zone which includes", so the app counts them inside the chosen centre (**assumption A2**).
- No duty to record the route in the lesson checklist; no form for it. Recording it is good practice, not a requirement (**assumption A3**).

**Correction for `docs/ACT_ASSESSMENT_STANDARDS.md` R10** (apply in task R10a):
add "2 designated zones (RTA-approved)", "UNFAMILIAR town centre", "within and
including the listed streets", and mark the stop/give-way/lights/crossings
counts as "minimum (assumption)".

## 2. Decisions

| # | Decision | Recommended default |
|---|---|---|
| D1 | Reminders only | Same contract as the rules engine: amber = not met / looks familiar, grey = cannot check, plain = met per entered data. Nothing blocks saving a lesson, assessing or achieving 23, or History Edit. |
| D2 | Town-centre table | Static, committed `lib/town-centres.ts`: `{ id, name, streetsAsPrinted[], aliases[] }` for the 7 accepted centres (Manuka + Kingston = one entry), source NI2020-703 p 37 in the header. No external maps, no geocoding, no network. A test pins the 7 ids and the verbatim street lists. |
| D3 | Aliases (for matching free-text lesson locations) | Civic: "civic", "canberra city", "city centre"; Gungahlin; Belconnen: "belconnen", "belco"; Woden; Tuggeranong: "tuggeranong", "tuggers"; Fyshwick; Manuka/Kingston: "manuka", "kingston". Whole-word, case-insensitive. Tony may add local names (Q2). Street names are **not** used for matching (too many false hits, e.g. Canberra Ave borders two centres). |
| D4 | "Familiar" (A4, product rule, Q1) | A centre is familiar to this learner when any **earlier** lesson of the learner (any instructor, App or paper; prior-instructor rows have no location) has a `location` matching it. An earlier Competency 23 attempt there counts the same way (its location matches). The rule is evidence for the instructor, never a verdict: the instructor decides. |
| D5 | Suggestion | When 23 Final Drive is `ready`, the Start Lesson panel adds one line: "Unfamiliar town centres (no earlier lesson there): Woden, Fyshwick, Tuggeranong." in table order. All 7 familiar: amber "Every town centre appears in earlier lesson locations; choose the least practised." No lesson has any location: grey "No lesson locations recorded, so familiar town centres cannot be checked." This is the panel's 4th line, only in the 23-ready state. |
| D6 | Route check (in the lesson form) | When 23 Final Drive is ticked as Assessed, a collapsed group "Competency 23 route" appears under the competency picker: (a) town centre: 7 chips, the first suggested one preselected (one tap to change); (b) six ticks: "2 designated zones", "1+ stop sign", "1+ give way sign", "2+ traffic lights", "2+ pedestrian crossings", "5+ right and 5+ left turns", plus one **"All met"** button that ticks all six. Common case: open + "All met" = two taps. No counters, no typing. |
| D7 | Checks on the draft (display only) | Chosen centre familiar per D4: amber "Woden appears in Lesson #4, #9 locations. Is it unfamiliar to this learner?" Any tick missing while 23 is Achieved: amber "Route check not complete: traffic lights, turns. You can still save." No centre chosen: grey "Choose the town centre to check the route." All ticked + unfamiliar: plain "Route check: all Competency 23 route items ticked (Woden)." |
| D8 | When it is used: phone limit | The checklist is filled **after** the drive (CoP 5 f, C3: ≤ 30 s phone use; I7: the student drives unaided and the instructor must concentrate). The suggestion is read before the lesson (booking time). No in-drive interaction is designed; GPS counting is P4. |
| D9 | Storage (no migration) | The chosen centre is written into the lesson's existing `location` (if empty; otherwise prefixed "Woden: …", within the 200-char limit) and one generated line is appended to `comments`: "Comp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked." (or "… not ticked: lights, turns"). Both fields already print on the PDF (overflow goes to Additional Notes, never truncated), are covered by lesson revisions and the owner-only edit rule (CoP 9.2 d), and later feed D4. Re-opening History Edit parses the exact generated line back into ticks (pure function, round-trip tested); an altered line is left as plain comment text. |
| D10 | ACTGDS | Nothing sent. `location` and `comments` are not in the V1 contract; no contract change, hash `c43d2816…b7e6` unchanged (test). Town centres and ticks are never added to the outbox. |
| D11 | Computation | Pure functions in `lib/route-check.ts` (`familiarTownCentres(lessons, beforeLessonNo)`, `suggestTownCentres`, `routeLine(state)`, `parseRouteLine(text)`), run in the browser on `detail.lessons` already loaded. Zero new D1 statements; the save path is the existing create/update with the same bound parameters. |
| D12 | Second designated zone | Recorded only as the tick "2 designated zones"; the app does not know the RTA zone list (Q3). |

## 3. Data model

No migration in R10a/R10b (D9). A structured table (`lesson_route_checks`:
lesson_id, town_centre_id, items_json, checked_at, by) is deferred to P4 GPS,
where route data needs its own storage and Tony's separate approval anyway.

## 4. D1 budget

R10a and R10b: **0 new statements**, no new bound parameters (location ≤ 200
and comments ≤ 3000 are already bound). The existing budget test is re-run
unchanged.

## 5. Privacy

Town-centre names and ticks are teaching data, not learner PII. Nothing new is
stored outside the lesson row, nothing is sent to ACTGDS, no GPS, no addresses
(pick-up / drop-off for the ADI Audit booking stay out of the app, per the R4
decision).

## 6. Tests and QA

`tests/route-check.test.ts`: table pins 7 centres and the verbatim street lists
(incl. "Gunghalin Dr", "Athllon Dr"); alias matching (whole word, case,
"Kingston" → Manuka/Kingston, "Canberra Ave" → nothing); familiarity counts
only earlier lessons, any instructor, paper rows, ignores prior rows; History
Edit of an earlier location changes the result; suggestion order deterministic;
all-familiar and no-location cases; route line build + parse round trip;
location prefix respects 200 chars; comments append respects 3000 chars.
API: a lesson with 23 Assessed + Achieved and no route data saves (never
blocks). Integration payload test: no new keys, hash unchanged.

`qa-browser` at 375px: panel line in the 23-ready state; form group appears only
with 23 Assessed; "All met" ticks six in one tap; amber familiar warning; Save
works with an incomplete checklist; PDF shows the route line; no horizontal
scroll.

Tony's manual smoke test: none (no real-device-only behaviour).

## 7. Phases

| Task | Content | Migration |
|---|---|---|
| R10a (smallest slice) | `lib/town-centres.ts`, D4/D5 suggestion line, ACT_ASSESSMENT_STANDARDS R10 correction, tests | none |
| R10b | Route check group (D6, D7), storage in location + comments (D9), parse-back, tests, qa-browser | none |
| P4 (later, separate approval) | GPS track inside the centre's boundary streets, automatic counts suggested for the ticks | new infrastructure |

Each task ends with a stop and a report (AGENTS.md §11).

## 8. Risks

- Free-text locations are inconsistent ("Westfield Belco"); D3 aliases catch the common forms; misses only make a centre look unfamiliar, so the warning is advisory and the instructor decides.
- The ticks are self-attested; they record what the instructor says, like the rest of the checklist. The PDF line must never claim more than "ticked".
- The instrument's street table has typos and repeats; we keep them verbatim and never derive geometry from them before P4.

## 9. Open questions for Tony (defaults chosen; one word each)

| # | Question | Recommended default |
|---|---|---|
| Q1 | Is "familiar" = the learner has had any earlier lesson whose location names that town centre? | Yes (D4). |
| Q2 | Which local names do you write in Location (e.g. "Belco", "the City", "Tuggers")? | The D3 list; add yours anytime. |
| Q3 | Do you know the RTA's "designated zones" (I3) beyond the 7 town centres? | Unknown; record only a "2 designated zones" tick. |
| Q4 | Store the route as the lesson location + one comment line (prints on the PDF), not a new table? | Yes, no migration. |
| Q5 | Treat 1 stop / 1 give way / 2 lights / 2 crossings as minimums (only turns say "minimum")? | Yes (A1). |
| Q6 | Show the suggestion on the Start Lesson panel as a 4th line when 23 is ready? | Yes. |
