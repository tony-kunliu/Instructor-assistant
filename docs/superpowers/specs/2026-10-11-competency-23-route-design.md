# Competency 23 route suggestions and route check (R10) — design

_Date: 2026-10-11 · Status: **DESIGNED; questions decided by Tony 2026-10-11**
(defaults accepted, with one change: "familiar" = the learner's home district,
D4; Weston Creek / Molonglo: no neighbouring centre, decided 2026-10-11) · **Built 2026-10-11 on `feature/route-r10a`** (R10a + R10b content in one slice, no migration; `lib/town-centres.ts`, `lib/act-suburbs.ts`, `lib/route-check.ts`, `app/route-check.tsx`; suburb table cross-checked against Wikipedia's list of Canberra suburbs, see the file header for the entries left out) ·
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

- **"Unfamiliar"** is not defined: no rule for how the instructor decides a town centre is unfamiliar to the student. Tony's rule (2026-10-11), a school practice, not instrument text: the centre of the learner's **home district** is familiar (D4).
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
| D3 | Home district source | **Derived from the existing `learners.address` text** with a static suburb table `lib/act-suburbs.ts` (§2a). No migration, no new field, computed in the browser; the address never leaves the learner record. Matching: whole-word, case-insensitive suburb names; when several match (a street can be named after a suburb, e.g. "Gungahlin Dr"), the match **nearest the end** of the address wins (suburb comes after the street in Australian addresses). The result is always shown with its evidence: "Home district: Belconnen (from 'Florey' in the address)." |
| D4 | "Familiar" (Tony 2026-10-11) | A town centre is familiar when it is the accepted centre of the learner's home district (§2a). Example: a learner living in Florey (Belconnen district) should be tested in Gungahlin, the City or another centre, not Belconnen. Earlier lesson locations are **not** used (optional extra later, off by default, not in R10a/R10b). Evidence for the instructor, never a verdict. |
| D5 | Suggestion | When 23 Final Drive is `ready`, the Start Lesson panel adds one line listing the **other** centres, home centre excluded: "Unfamiliar town centres (home: Belconnen): Civic, Gungahlin, Woden, Tuggeranong, Fyshwick, Manuka/Kingston." Home district with no accepted centre (Weston Creek, Molonglo Valley) or an address outside the ACT: plain "Home district Weston Creek has no accepted town centre: all 7 are unfamiliar by this rule." Address empty or no suburb matched: grey "Cannot check the home town centre: add the learner's suburb to the address." This is the panel's 4th line, only in the 23-ready state. |
| D6 | Route check (in the lesson form) | When 23 Final Drive is ticked as Assessed, a collapsed group "Competency 23 route" appears under the competency picker: (a) town centre: 7 chips, the first suggested one preselected (one tap to change); (b) six ticks: "2 designated zones", "1+ stop sign", "1+ give way sign", "2+ traffic lights", "2+ pedestrian crossings", "5+ right and 5+ left turns", plus one **"All met"** button that ticks all six. Common case: open + "All met" = two taps. No counters, no typing. |
| D7 | Checks on the draft (display only) | Chosen centre is the home centre per D4: amber "Belconnen is the learner's home district (from 'Florey' in the address). Competency 23 needs an unfamiliar town centre. You can still save." Any tick missing while 23 is Achieved: amber "Route check not complete: traffic lights, turns. You can still save." No centre chosen: grey "Choose the town centre to check the route." All ticked + unfamiliar: plain "Route check: all Competency 23 route items ticked (Woden)." |
| D8 | When it is used: phone limit | The checklist is filled **after** the drive (CoP 5 f, C3: ≤ 30 s phone use; I7: the student drives unaided and the instructor must concentrate). The suggestion is read before the lesson (booking time). No in-drive interaction is designed; GPS counting is P4. |
| D9 | Storage (no migration) | The chosen centre is written into the lesson's existing `location` (if empty; otherwise prefixed "Woden: …", within the 200-char limit) and one generated line is appended to `comments`: "Comp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked." (or "… not ticked: lights, turns"). Both fields already print on the PDF (overflow goes to Additional Notes, never truncated) and are covered by lesson revisions and the owner-only edit rule (CoP 9.2 d). Re-opening History Edit parses the exact generated line back into ticks (pure function, round-trip tested); an altered line is left as plain comment text. |
| D10 | ACTGDS | Nothing sent. `location` and `comments` are not in the V1 contract; no contract change, hash `c43d2816…b7e6` unchanged (test). Town centres and ticks are never added to the outbox. |
| D11 | Computation | Pure functions in `lib/route-check.ts` (`homeDistrict(address)` → `{ district, townCentreId \| null, matched } \| null`, `suggestTownCentres(home)`, `routeLine(state)`, `parseRouteLine(text)`), run in the browser on `detail.learner.address` already loaded. Zero new D1 statements; the save path is the existing create/update with the same bound parameters. |
| D12 | Second designated zone | Recorded only as the tick "2 designated zones"; the app does not know the RTA zone list (Q3). |
| D13 | Alternative considered: `learners.home_district` field | Not recommended now. It would need migration `0012` (`ALTER TABLE learners ADD COLUMN home_district TEXT`, nullable, values = district ids from §2a, added to `LEARNER_EDIT_KEYS` and the revision snapshot, one more bound parameter in create/edit) and one more field for Tony to fill. Revisit only if the address-derived result is often grey or wrong in real use; then the field would override the derivation. |

### 2a. Suburb → district → town centre table (`lib/act-suburbs.ts`)

Static, committed, from general knowledge of the ACT district structure (not
from the instruments). The implementer re-checks it against the ACT
Government's suburb/district list before R10a ships; entries marked **(?)** are
uncertain and are left **out** of the table until checked, so they give the
grey "add the suburb" line rather than a wrong answer.

| District | Accepted town centre | Suburbs |
|---|---|---|
| Belconnen | Belconnen | Aranda, Belconnen, Bruce, Charnwood, Cook, Dunlop, Evatt, Florey, Flynn, Fraser, Giralang, Hawker, Higgins, Holt, Kaleen, Latham, Lawson, Macgregor, Macnamara, Macquarie, McKellar, Melba, Page, Scullin, Spence, Strathnairn, Weetangera |
| Gungahlin | Gungahlin | Amaroo, Bonner, Casey, Crace, Forde, Franklin, Gungahlin, Harrison, Jacka, Kenny, Mitchell, Moncrieff, Ngunnawal, Nicholls, Palmerston, Taylor, Throsby |
| North Canberra (Inner North) | Canberra City (Civic) | Acton, Ainslie, Braddon, Campbell, City, Dickson, Downer, Hackett, Lyneham, O'Connor, Reid, Turner, Watson |
| South Canberra (Inner South) | Manuka and Kingston | Barton, Deakin, Forrest, Griffith, Kingston, Narrabundah, Parkes, Red Hill, Yarralumla |
| Woden Valley | Woden | Chifley, Curtin, Farrer, Garran, Hughes, Isaacs, Lyons, Mawson, O'Malley, Pearce, Phillip, Swinger Hill, Torrens |
| Tuggeranong | Tuggeranong | Banks, Bonython, Calwell, Chisholm, Conder, Fadden, Gilmore, Gordon, Gowrie, Greenway, Isabella Plains, Kambah, Macarthur, Monash, Oxley, Richardson, Theodore, Wanniassa |
| Weston Creek | none | Chapman, Duffy, Fisher, Holder, Rivett, Stirling, Waramanga, Weston |
| Molonglo Valley | none | Coombs, Denman Prospect, Whitlam, Wright |
| Fyshwick | Fyshwick | Fyshwick (?) (mostly commercial; its official district is uncertain) |
| Left out until checked (?) | — | Hume, Symonston, Pialligo, Majura, Beard, Oaks Estate, Hall, Capital Hill, Molonglo (suburb name vs district), Sulman (newly gazetted) |
| Outside the ACT | none | Queanbeyan, Jerrabomberra, Googong, Karabar, Murrumbateman and other NSW places: matched as "outside the ACT" by an explicit short list or a NSW postcode/"NSW" token |

Aliases from the accepted Q2 default apply to address text too ("Belco" →
Belconnen district). A district with no accepted centre is not mapped to a
neighbouring centre (e.g. Weston Creek is not treated as Woden); see §9
remaining question.


## 3. Data model

No migration in R10a/R10b (D9). A structured table (`lesson_route_checks`:
lesson_id, town_centre_id, items_json, checked_at, by) is deferred to P4 GPS,
where route data needs its own storage and Tony's separate approval anyway.

## 4. D1 budget

R10a and R10b: **0 new statements**, no new bound parameters (location ≤ 200
and comments ≤ 3000 are already bound). The existing budget test is re-run
unchanged.

## 5. Privacy

Town-centre names and ticks are teaching data, not learner PII. The home
district is computed in the browser from the address already loaded for the
learner panel; the address is not copied, stored again, logged or sent, and the
lesson row stores only the chosen centre's name. Nothing is sent to ACTGDS, no
GPS, no pick-up / drop-off addresses (the ADI Audit booking stays out of the
app, per the R4 decision). Tests use synthetic `QA …` learners and invented
street numbers only.

## 6. Tests and QA

`tests/route-check.test.ts`: table pins 7 centres and the verbatim street lists
(incl. "Gunghalin Dr", "Athllon Dr"); suburb table shape (no suburb in two
districts, every district's centre id exists or is null, no "(?)" entry
included); `homeDistrict`: "12 Smith St, Florey ACT 2615" → Belconnen;
"3 Gungahlin Dr, Florey" → Belconnen (nearest the end wins); "Belco" alias;
case and punctuation; Weston Creek / Molonglo → no centre, all 7 suggested;
NSW address → outside the ACT; empty or unmatched address → grey; the
suggestion excludes exactly the home centre and keeps table order; amber when
the chosen centre is the home centre; route line build + parse round trip;
location prefix respects 200 chars; comments append respects 3000 chars.
API: a lesson with 23 Assessed + Achieved and no route data saves (never
blocks). Integration payload test: no new keys, hash unchanged.

`qa-browser` at 375px: panel line in the 23-ready state (synthetic `QA …`
learner with a Florey address, then with an empty address → grey); form group appears only
with 23 Assessed; "All met" ticks six in one tap; amber home-centre warning; Save
works with an incomplete checklist; PDF shows the route line; no horizontal
scroll.

Tony's manual smoke test: none (no real-device-only behaviour).

## 7. Phases

| Task | Content | Migration |
|---|---|---|
| R10a (smallest slice) | `lib/town-centres.ts`, `lib/act-suburbs.ts` (§2a, re-checked against the ACT Government list), D3-D5 home-district suggestion line, ACT_ASSESSMENT_STANDARDS R10 correction, tests | none |
| R10b | Route check group (D6, D7), storage in location + comments (D9), parse-back, tests, qa-browser | none |
| P4 (later, separate approval) | GPS track inside the centre's boundary streets, automatic counts suggested for the ticks | new infrastructure |

Each task ends with a stop and a report (AGENTS.md §11).

## 8. Risks

- Free-text addresses are inconsistent or may name a street after another suburb; D3's nearest-the-end rule and the visible evidence ("from 'Florey'") let the instructor spot a wrong match; unmatched gives grey, never a guess.
- A learner who moved keeps an old address: the result follows the stored address; Tony edits the address (learner edit) to fix it.
- Home district is Tony's school rule; it may not capture every familiar area (a learner who works or studies in Civic). The instructor still decides.
- The ticks are self-attested; they record what the instructor says, like the rest of the checklist. The PDF line must never claim more than "ticked".
- The instrument's street table has typos and repeats; we keep them verbatim and never derive geometry from them before P4.

## 9. Questions — decided by Tony 2026-10-11

All defaults accepted, except Q1, which Tony changed.

| # | Question | Decision (2026-10-11) |
|---|---|---|
| Q1 | What makes a town centre "familiar"? | **Changed by Tony:** the learner's home district (where the learner lives), not earlier lesson locations. Derived from the address (D3, D4); no new field (D13). |
| Q2 | Local names (e.g. "Belco", "the City", "Tuggers")? | Default accepted: the alias list, now applied to address text. |
| Q3 | RTA "designated zones" beyond the 7 town centres? | Default accepted: unknown; record only a "2 designated zones" tick. |
| Q4 | Store the route as location + one comment line, no new table? | Default accepted: yes, no migration. |
| Q5 | Treat 1 stop / 1 give way / 2 lights / 2 crossings as minimums? | Default accepted: yes (A1). |
| Q6 | Suggestion as a 4th line on the Start Lesson panel when 23 is ready? | Default accepted: yes. |

**Decided by Tony 2026-10-11 (was the remaining open question):** learners living in a
district with no accepted town centre (Weston Creek, Molonglo Valley) do **not** count a
neighbouring centre as home. All 7 centres stay suggested (D5), because the rule is
"home district" and these districts have none. No open questions remain.
