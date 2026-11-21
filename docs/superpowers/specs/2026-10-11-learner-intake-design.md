# Learner intake: address suggestions, overseas/interstate licence, Competency 23 date, licence scan — design

_Date: 2026-10-11 · Status: **DESIGNED; questions decided by Tony 2026-10-11** (§9). Implementation needs
Tony's go per phase (no code yet) · Based on `origin/staging` 6c8df98 · Builds on the rules engine
(`2026-10-10-rules-reminders-and-learner-phase2-design.md`: D1 reminders never block, D12 month
arithmetic, D21 issue date estimated from expiry) and the route design
(`2026-10-11-competency-23-route-design.md`: D3 home district from the address, `lib/act-suburbs.ts`)._

## 中文摘要（给 Tony）

**已决定（2026-10-11）**：Q3、Q7、Q8、Q9、Q11 用默认值；Q1、Q2、Q4、Q5、Q6、Q10 按你的回答修改（见 §9）。

1. **地址自动提示**：用**打包在 App 里的静态街道表**（来自政府开放数据 G-NAF，ACT + Queanbeyan/Jerrabomberra/Googong 一带共 11 个 NSW 地点，约 7,900 条“街道+区+邮编”，压缩后约 50 kB）。免费，不需要新服务、不需要密钥，学员地址不发给第三方，离线也能用。门牌号照你打的保存，不核对。街道类型用缩写（“Av”）。选中提示时同时存“区/州/邮编”，这样 Competency 23 的“家所在区”就是准确的。你的例子“44 Apple Av, Acton”**不是真实街道**（最接近的是 Jacka 的 Appleford Av）。
2. **海外/外州驾照**：学员资料加“是否持有海外或外州驾照”，选“是”再填：外州还是海外、州或国家、驾照号、类型（学习 / 正式）、签发日、到期日。你的规则（**你已向主管部门确认，2026-10-11**），不要求考试当天该驾照仍有效（到期日只作记录）：
   - **外州学习驾照**：持有时间计入等待期（12/6 个月），和 ACT 学习驾照一样算；这也符合 ACT 法规“learner licence 包括其他澳洲辖区签发的”。
   - **外州正式驾照**：从签发日到考试日满 12 个月，则不需要等待期。
   - **海外正式驾照**：任何国家都可以；从签发日到考试日满 12 个月，则不需要等待期。
   - **海外学习驾照不算**：App 会写明“overseas learner licences do not count”。

   小时数（100/50）、HPT、年龄仍照常检查。App 显示正常提示，标注“school rule, confirmed by Tony”。注意：NI2020-703 和 CoP 原文没有这条，记录在 §1。
3. **“Competency 23 最早日期”**：自动计算。25 岁前签发 = 签发日 + 12 个月（且满 17 岁），25 岁及以上 = 签发日 + 6 个月；签发日留空时用到期日 − 5 年估算，显示“≈”。PDF 的 Eligibility 栏**自动填** `C23 from YYYY-MM-DD`，但只在该栏为空，或还是 App 之前生成的内容时才写；你自己写的内容永远不覆盖。表单里看得到，也可以改。
4. **拍照识别驾照**：只做免费方案：iPhone/iPad 自带的“扫描文本”（Live Text，手机本地识别）加 App 本地解析，你逐项确认。Claude/AI 识别**不做**（你选只用免费方案）。不保存任何证件照片。
5. 分 4 个小任务，最小的先做（P1 只做第 3 项，无 migration）。ACTGDS 合同不变（hash 不变），新数据不发给网站。

## 1. What the instruments say about overseas / interstate licences (verified 2026-10-11)

Read with `pdftotext -layout` from NI2020-703 (38 pp) and DI2020-294 (14 pp) in the session scratchpad,
plus the current Road Transport (Driver Licensing) Regulation 2000 (SL2000-14, republication R83,
effective 13 Jun 2026) and Act 1999 (A1999-78, R43), downloaded from legislation.act.gov.au the same
day. Page = printed page (CoP: PDF page).

| # | Text (verbatim) | Source |
|---|---|---|
| L1 | "If the student holds a new learner licence Competency 23 may only be undertaken by a student: o after completing their 100 required driving hours, having held the new learner licence for at least 12 months, successfully completed the hazard perception test and at least 17 years of age, if the student was aged under 25 when issued with their learner licence; o after completing their 50 required driving hours, having held the new learner licence for at least 6 months, successfully completed the hazard perception test, if the student was aged 25 or older …" "A new learner licence means a learner licence or renewed learner licence issued on or after 1 January 2020." | NI2020-703 Sch 1, Competency 23, p 36 |
| L2 | "Students must hold a valid ACT learner licence (or an otherwise applicable licence as advised by Access Canberra) when undertaking driver instruction or driver assessment." | CoP (DI2020-294) 9 c, p 9 |
| L3 | Booking must include "The student's ACT learner licence number (or licence details as applicable)". | CoP 9.2 n ii, p 11 |
| L4 | "Student means a person who has been granted a learner driver licence or a learner driver licence receipt, in relation to a car licence." | CoP 2 a (definitions), p 4 |
| R1 | Provisional car licence eligibility: "(b) the person has at any time held a learner car licence for— (i) if the person was 25 years old or older at the time the licence was issued or renewed—6 months; or (ii) in any other case—12 months"; (c) 50 h incl. 5 h night / 100 h incl. 10 h night; (d) HPT "(i) in accordance with section 23; or (ii) under the law of another jurisdiction". | Regulation s 22 (3), pp 27-28 |
| R2 | "learner licence means an Australian driver licence issued to a person under the law of any jurisdiction …"; "Australian driver licence" includes a learner licence "issued under the law of another jurisdiction". | Act, Dictionary, pp 48-49 |
| R3 | In working out the period a licence has been held, the RTA must count every period the person held an Australian driver licence "(or an external territory driver licence or a foreign driver licence issued under the law of a recognised country corresponding to an Australian driver licence of a particular class or kind)", excluding suspension/disqualification. | Regulation s 68 (1), p 66 |
| R4 | "A person is exempt from the eligibility requirements for a class of licence applied for if the person holds, or has at any time held— (a) an Australian driver licence (other than a learner licence) of that class or a higher class; … (c) a foreign driver licence issued under the law of a recognised country that corresponds to that class or a higher class." | Regulation s 66A, pp 64-65 |
| R5 | The RTA may, "because of a person's special circumstances", exempt a person from s 22 (3) (a), (b) or (c) "(other than (c) (i))". | Regulation s 67 (1), p 65 |
| R6 | "recognised country … means a country listed as a recognised country by Austroads". | Regulation s 141, p 201 |

**Finding.** Neither NI2020-703 nor the CoP mentions overseas or interstate licences; the words
"overseas", "interstate" and "foreign" do not occur in either, and neither has an exemption from the
Competency 23 eligibility conditions. The Regulation (R1-R6) governs the **RTA's** decision to issue a
provisional licence, not the instructor's Competency 23 check. It treats a non-learner licence (R4), and
recognised-country licences (R3, R4), differently from learner licences.

**Tony's school rule (confirmed by Tony with the authority, 2026-10-11):**

- **Interstate learner licence:** its time counts towards the 12/6-month learner-licence wait, exactly as
  ACT learner time does. This matches R1 + R2 + R3: a "learner licence" includes one issued under any
  Australian jurisdiction's law, and every period held counts.
- **Interstate full licence, or overseas full licence (any country):** held for at least 12 months from
  its issue date to the Competency 23 drive date, it removes the 12/6-month wait.
- **Overseas learner licence:** does **not** count.
- **Other classes:** a provisional or permit-type licence is recorded as class `other` and does not count
  (assumption, §9).
- **Currency:** the other licence need not still be current on the drive date. The **hours (100/50), HPT and age** conditions still apply: the instruments have no
exemption from them, and Tony's rule covers only the wait. Under R1 (d)(ii), an HPT passed in another
jurisdiction counts, so the existing `hptPassedOn` takes that date. The app records the rule as stated by
Tony; the instrument text above stays the reference if the authority's position changes.

## 2. Decisions

### Feature 1: address suggestions

| # | Decision |
|---|---|
| D1 | **Source: a static, bundled street index built from G-NAF** (Geoscape, on data.gov.au; quarterly releases, Aug 2026 current). Licence: Open G-NAF EULA = CC BY 4.0 plus one use restriction (no generating addresses for **sending mail** without a second-source check). This app sends no mail, so the restriction does not apply. An attribution line goes in the app's About/footnote and in the data file header. |
| D2 | **Coverage and size** (measured 2026-10-11 from the Aug 2026 release). Every non-retired ACT street locality with at least one address (6,953 entries) plus all streets of 11 nearby NSW localities: Queanbeyan, Queanbeyan East, Queanbeyan West, Karabar, Crestwood, Greenleigh, The Ridgeway, Jerrabomberra, Googong, Tralee, Royalla (983 entries). Total **7,936 street + suburb + postcode entries** across 146 localities; compact JSON is 177 kB, **48 kB gzipped**. No further NSW places (Tony, Q8). ACT postcodes come from G-NAF address details (the most common postcode per street). NSW postcodes come from a short committed table (Jerrabomberra 2619, the others 2620), which the build re-checks against the NSW address details. |
| D3 | **Delivery.** `public/data/streets-<gnaf-release>.json` (hashed name, `Cache-Control: immutable`) is fetched on first focus of the Address field and then held in memory. It is a static asset: no Worker CPU, no D1, no new infrastructure. If the fetch fails, or the device is offline before the first load, the field works as a plain text input. |
| D4 | **Matching** (pure, `lib/address-suggest.ts`). The query is an optional unit/number token kept **as typed** (`44`, `3/44`, `44A`), then a word-prefix match on the street name, optionally followed by a suburb prefix ("44 app", "44 appleford ja"). At most 5 results, ordered: exact prefix first, ACT before NSW, then alphabetical. Display uses Australia Post abbreviations in title case (Tony, Q9): "44 Appleford Av, Jacka ACT 2914". House numbers are **never verified**. A per-address index (about 278,000 ACT addresses, roughly 1-2 MB more) was considered and rejected. |
| D5 | **Tony's example.** "Apple Av, Acton" **does not exist** in G-NAF: Acton has 30 streets and none starts with "Apple". "44 app" would offer Appleford Av (Jacka ACT 2914), Applebox Pl (Jerrabomberra NSW) and Appleberry Rd (Tralee NSW). |
| D6 | **UI (iPhone/iPad Safari).** A custom listbox appears under the existing Address input. It is not a `<datalist>`, because that cannot rank number-prefixed queries. Rows are at least 44 px tall, with at most 5. A tap fills the text and keeps the keyboard open. "×" or blur closes it. The input stays `type="text"` and is never `readonly`, so iOS Scan Text still works (D19). Suggestions start after 3 typed letters of the street. Free text always saves, with or without a pick, and an unmatched address never warns. |
| D7 | **Structured fields.** New nullable `address_suburb`, `address_state` and `address_postcode`, set **only when a suggestion is picked**. If the address text is edited afterwards, the form keeps them only while the text still contains the suburb as a whole word; otherwise it clears them. The server validates their shape (suburb ≤ 60 characters, state one of ACT/NSW/VIC/QLD/SA/WA/TAS/NT, postcode 4 digits) and that the suburb appears in the address text. It does not need the index. |
| D8 | **Route design link.** R10's `homeDistrict()` uses `address_suburb` when it is set (exact, with evidence "from the picked suburb Florey"). Otherwise it falls back to the D3 text derivation. The G-NAF ACT locality list is also used to check the §2a suburb table in the route design. |
| D9 | **Rejected options.** **(b) Places APIs:** Tony chose free options only (Q10). Google Places Autocomplete (New), as read on Google's pricing page 2026-10-11, has 10,000 free requests a month, then USD 2.83 per 1,000. Mapbox Search Box has about 500 free sessions, then about USD 11.50 per 1,000. Both also need a billing account, an API key secret, a Worker proxy and new-service approval, and both send partial learner addresses offshore. **(c) OSM Nominatim public instance:** its usage policy says "Auto-complete search … you must not implement such a service" (strictly forbidden; offenders are banned). It also allows at most 1 request per second and its data is ODbL share-alike. |
| D10 | **Updates.** `scripts/build-street-index.mjs` (Node, run by an agent, not in CI) reads the G-NAF PSV files for the ACT and the listed NSW localities. It writes the JSON with a header naming the release and the attribution. It can range-read only the needed files out of the 1.85 GB national ZIP, as done for this design. A yearly BACKLOG item adds new streets in new suburbs (e.g. Whitlam, Sulman). |

### Feature 2: overseas / interstate licence

| # | Decision |
|---|---|
| D11 | **Fields** (New and Edit learner form, collapsed group "Overseas or interstate licence"). All are optional and nothing blocks a save. The hint says "Interstate learner time counts towards the wait; an interstate or overseas full licence held 12 months removes it; overseas learner licences do not count." |
| | `other_licence_kind`: NULL = not recorded, `none`, `interstate`, `overseas`. This is the yes/no; "Yes" asks interstate or overseas. |
| | `other_licence_place`: an Australian state or territory code (not ACT) for interstate, or a country name for overseas (any country; suggested from a bundled English country list, free text allowed). |
| | `other_licence_number` (≤ 40, uppercase). |
| | `other_licence_class`: `learner`, `full` (full/unrestricted car licence) or `other` (provisional, permit, restricted, unknown kinds; does not count), or NULL = not recorded. |
| | `other_licence_issued_on`: label "First issued (if known, otherwise the issue date on the card)" (Q3). |
| | `other_licence_expires_on`: **for information only** (Q4); no rule reads it. |
| D12 | **Validation** (shared `parseLearnerFields`; strict on edit; cross-field rules only when a touched key is involved, as in the 0009 D19 rules). Dates must be real calendar dates. The issue date must be on or before today and on or after `dob`. Expiry must be on or after the issue date. The class must be one of the three values. The place must be valid for the kind (a state code other than ACT for interstate, ≤ 60 characters for overseas). Choosing "No" clears the detail fields; the old values stay in the revision history. |
| D13 | **R2 integration** (`finalDriveEligibilityReminder`), by kind and class. Expiry is ignored in every case (Q4). Hours, HPT and age are always still checked as today. All results are labelled "school rule, confirmed by Tony", are never a pass unless the conditions below hold, and never block anything. |
| | **(a) Interstate learner:** the wait (12 months under 25 / 6 months 25+, band as today from the ACT licence) is counted from `other_licence_issued_on` instead of the ACT issue date. This assumes continuous learner holding into the ACT licence (no gap check). Line: "licence held 12 months on 3 Mar 2026 (counted from the NSW learner licence, school rule)". If the interstate issue date falls in a different age band from the ACT issue date, the result is grey "Age band unclear", as for a renewed licence today. |
| | **(b) Interstate full or overseas full:** when the drive date is at least 12 months after `other_licence_issued_on` (D12 arithmetic, forward clamp), the wait is met by "learner-licence wait not needed: full NSW licence held 12 months on 3 Mar 2026 (school rule)". If held for less than 12 months, the normal ACT wait applies, with "the school rule applies from <date>". If everything is met, the result is **plain**: "Competency 23 eligibility met per entered data (school rule: …)". |
| | **(c) Overseas learner:** the normal ACT wait applies. A note is added to the R2 line: "Overseas learner licences do not count towards the wait (school rule)". The tone follows the ACT result: amber when the wait is not yet met, plain when it is. |
| | **(d) Class `other`:** the normal ACT wait applies, with "Only an interstate learner licence, or an interstate or overseas full licence, counts (school rule)". |
| | **(e) Class not recorded, or no issue date while (a) or (b) could apply:** the normal ACT wait is still checked, plus a grey "Add the licence type and issue date to check the school rule". |
| | Constants in `lib/rules.ts`, commented with Tony's confirmation date: `OTHER_FULL_LICENCE_MONTHS = 12`; interstate learner time uses the band's months. |
| D14 | **Revisions.** All new keys join `LEARNER_EDIT_KEYS` (the snapshot is the same `json_object`, still 4 bound parameters). Revision labels are added. Old snapshots lack the keys, which read as null. |
| D15 | **PDF.** No new field prints: the official checklist header has none. The ACT learner licence stays in "Licence number". The auto-filled Eligibility date (D18) already reflects the school rule. |
| D16 | **No photo is stored** (Q11). "Photo capture" for this licence is the Scan Text helper (D19). |

### Feature 3: "Competency 23 eligible from"

| # | Decision |
|---|---|
| D17 | **Computation** (pure `finalDriveEligibleFrom(learner)` in `lib/rules.ts`, reusing `evaluateEligibility`'s per-condition "met on" dates). The result is the latest of the date conditions. |
| | **New licence, under 25 at issue:** issue + 12 months, and the 17th birthday. |
| | **25 or older at issue:** issue + 6 months (Tony's wording, same as L1). |
| | **Old licence (issued before 1 Jan 2020):** 5 months + 16 days held (from first issue if given), and 16 years 350 days of age. |
| | **School rule (D13):** for an interstate learner licence, the wait date is the interstate issue date + 12/6 months. For an interstate or overseas full licence, it is the date that licence reaches 12 months. An overseas learner licence changes nothing. The age date still counts. |
| | Hours and HPT have no date. They are listed as "plus 100 logged hours and HPT", or omitted when already met per the entered data. |
| | With the D21 estimate, the date is shown with "≈" and the ±14-day range ("≈ 15 Nov 2026, between 1 and 29 Nov") (Q7). Missing DOB, or different age bands for a renewed licence, gives a grey line with the reason and no date. |
| D18 | **Where it shows.** (1) Learner panel summary, one line, learner stage only: "Competency 23 from 15 Nov 2026 (licence 12 months; plus 100 h and HPT)". (2) Read-only and live inside the Edit/New form's "Competency 23 eligibility" group. (3) **The PDF Eligibility field is auto-filled (Tony, Q6), as specified below.** |
| | **Generated text:** `C23 from YYYY-MM-DD`, or `C23 from ~YYYY-MM-DD` when estimated (ASCII "~", because the compact PDF font may lack "≈"). |
| | **"Generated" means** the field matches `^C23 from ~?\d{4}-\d{2}-\d{2}$` exactly. Anything else is Tony's own text. |
| | **In the form:** while the field is empty or generated, the Eligibility input shows the current generated value. It updates live as the dates change, and is cleared if no date can be computed. A small hint reads "auto: from the licence dates". Tony can edit it; once his text no longer matches the pattern, it is never touched again. Clearing the field restarts auto-fill. Save sends the value as usual (it is in the revision history). |
| | **At PDF export:** if the stored value is empty or generated, the PDF prints the value computed at export time (so a stale generated date is refreshed, and a learner never opened in the form still gets it). Otherwise it prints Tony's text unchanged. Export writes nothing to D1. |
| | **Tests:** fit in the 94-pt box at 8 pt (`lib/pdf-layout.ts`), the pattern, never overwriting own text, refresh of stale generated values, empty when not computable. |

### Feature 4: licence scan (free options only)

| # | Decision |
|---|---|
| D19 | **iOS Scan Text (Live Text) plus a local parser.** On-device and free; nothing leaves the phone. Live Text is on iOS/iPadOS 15+ with A12-or-later devices: tap a text field, then "Scan Text" in the callout menu. It works only in editable text fields; `type="date"` opens a picker, so dates cannot be scanned in directly. |
| | The app adds a "Scan card text" textarea at the top of the New/Edit form (plain `<textarea>`, not readonly, no custom key handling). Tony scans the whole card into it, or pastes text copied from a photo in Photos. |
| | A pure local parser `parseLicenceText()` proposes name, DOB, licence number, expiry and address, and the other-licence fields. They appear as a review list with "Use" toggles; nothing is written until Tony applies and then saves. The textarea is never saved. |
| | Whether Scan Text appears in Safari web inputs on Tony's iPhone and iPad is a **real-device check** (§13). |
| D20 | **AI extraction (Claude API through a Worker): not planned** (Tony, Q10: free options only). Reopening it would need a new design section and Tony's approval of a new external service, a secret he sets himself, consent wording and a spend limit. |
| D21 | **Storing photos: not done** (Q11). It would need R2 object storage (new infrastructure), retention and deletion rules, and identity-document handling under the Privacy Act APPs. Tony already sights the card (CoP 9 a-b), and the app records only the details. |
| D22 | **Updated 2026-11-21 for direct photo capture.** New learner offers the camera, recognises locally with versioned, same-origin Tesseract and English language assets, and fills only empty fields. The first scan downloads several MB. The existing Save learner action persists reviewed fields only. Scan Text and manual entry remain available. No licence images or OCR text are persisted. |

### Cross-cutting

| # | Decision |
|---|---|
| D23 | **ACTGDS:** no contract change. The schema hash stays `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6` (existing alignment test plus an assertion that no new key appears in the payload). New fields are never put in the outbox and editing them emits no event. The address is the learner record's existing PDF field; this design only helps Tony type it (AGENTS.md §10). |
| D24 | **Time:** "today" and every displayed date are in Canberra time (§15, `localNow`). |

## 3. Migrations (additive only)

Use the next free numbers when built (3c transfer reserves `0011`).

```sql
-- P2 (address)
ALTER TABLE learners ADD COLUMN address_suburb TEXT;
ALTER TABLE learners ADD COLUMN address_state TEXT;
ALTER TABLE learners ADD COLUMN address_postcode TEXT;
-- P3 (other licence)
ALTER TABLE learners ADD COLUMN other_licence_kind TEXT;      -- NULL | none | interstate | overseas
ALTER TABLE learners ADD COLUMN other_licence_place TEXT;
ALTER TABLE learners ADD COLUMN other_licence_number TEXT;
ALTER TABLE learners ADD COLUMN other_licence_class TEXT;     -- NULL | learner | full | other
ALTER TABLE learners ADD COLUMN other_licence_issued_on TEXT;
ALTER TABLE learners ADD COLUMN other_licence_expires_on TEXT; -- information only (Q4)
```

There are no defaults, no backfill and no rebuild. The same SQL is appended to `lib/schema.ts`; the
`d1-storage` test checks the concatenation. Enum checks live in `parseLearnerFields`, not in SQL `CHECK`
(which would need a table rebuild). Each migration is applied to Staging D1 before its merge (Staging D1
Migrate workflow). P1 needs no migration: the Eligibility field already exists.

## 4. D1 budget (Free plan: 500 MB per DB, ≤ 50 queries per invocation, ≤ 100 bound parameters)

| Path | Today | After |
|---|---|---|
| `createLearner` INSERT bound parameters | 16 | 25 (P2 + P3) |
| `updateLearner` statements / bound parameters | 5 / ≤ 16 | 5 / ≤ 26 |
| Revision INSERT … SELECT | 4 parameters | 4 (snapshot only grows) |
| Learner GET, panel, "eligible from", R2, PDF auto-fill | — | 0 new statements (columns come with the existing `SELECT`) |
| Address suggestions, Scan Text parser | — | 0 (static asset and pure client code) |

Storage: about 150 bytes more per learner row and about 250 bytes more per learner revision. For 1,000
learners with 5 edits each, that is under 1.5 MB, against the current Production DB of 324 kB and the
500 MB limit. The existing `d1-query-budget` test gains create/edit cases with every new field set.

## 5. Privacy

- **Address index:** public data, downloaded, so it reveals nothing about learners. Matching runs in the browser; no typed address leaves the device except in the normal learner save.
- **Scan Text:** recognition is done on the device by iOS, and the parser is local. The textarea is never saved, no image is ever sent or stored, and no third-party service is involved.
- **Other-licence numbers:** they stay in this app only. They are never sent to ACTGDS and are not used by the duplicate-licence warning.
- **Tests and QA:** synthetic `QA …` learners, invented licence numbers and synthetic card text only. No real card is ever committed.

## 6. Costs

Everything in this plan is free: the G-NAF index (USD 0, about 48 kB per device once), Scan Text (on
device), and the parser. No paid service and no new account. The paid options (Places APIs, Claude API
scan) were dropped by Tony's choice (Q10).

## 7. Phases (smallest safe slice first; each ends with a stop and a report, §11)

| Task | Content | Migration | External |
|---|---|---|---|
| **P1** | Feature 3: `finalDriveEligibleFrom`, panel line, form line, Eligibility auto-fill in the form and at PDF export (D17-D18), tests | none | none |
| **P2** | Feature 1: `scripts/build-street-index.mjs`, committed JSON and attribution, `lib/address-suggest.ts`, listbox UI, structured suburb fields (D7); R10 uses them when R10 is built (D8) | P2 columns | none |
| **P3** | Feature 2: other-licence group, validation, R2 school rule (D13), "eligible from" with the school rule, revisions | P3 columns | none |
| **P4** | Feature 4: "Scan card text" textarea and `parseLicenceText` with review list (D19) | none | none |
| ~~P5~~ | AI scan: **not planned (Tony: free options only)** | — | — |

## 8. Tests and QA

- **`tests/rules-eligible-from.test.ts`:**
  - each band on its boundary day: 12 / 6 months with forward clamp (31 Aug + 6 months = 1 Mar), 17th birthday later than 12 months, 29 Feb birthday;
  - old licence, estimate with range, missing DOB, renewed licence with differing bands;
  - hours and HPT already met so not listed; school-rule date;
  - auto-fill: pattern, own text never overwritten, stale generated value refreshed at export, cleared when not computable, fits the PDF box.
- **`tests/address-suggest.test.ts`**, against a small synthetic fixture:
  - "44 app" puts Appleford Av first; "3/44" and "44A" are kept; suburb narrowing; ACT before NSW; at most 5 results; no match gives an empty list;
  - keeping or clearing the structured fields after an edit.
  - The real JSON gets only a shape test: sorted, no duplicates, ACT/NSW only, 4-digit postcodes, attribution header.
- **R2 school rule:**
  - interstate learner: the wait counts from the interstate issue date (12 and 6 months, boundary day), and an age-band mismatch gives grey;
  - interstate full and overseas full: held exactly 12 months, and 1 day short; an expired licence still counts (Q4);
  - overseas learner: the normal ACT wait applies, with the "do not count" note; class `other` does not count;
  - class missing gives grey; issue date missing gives grey;
  - hours or HPT unmet gives amber; plain only when everything is met.
- **Repo:** create/edit validation for every new field, cross-field rules only when a touched key is involved, revision snapshot holds the new keys, migration concatenation equals `SCHEMA_SQL`, D1 budget assertions, ACTGDS payload unchanged (hash).
- **`parseLicenceText`** on synthetic Live-Text-like strings: dates as `dd/mm/yyyy` and `dd Mon yyyy`, labels in any order, OCR noise. It only proposes and never writes.
- **`qa-browser` at 375 px:** listbox with 44 px rows and no horizontal scroll, tap fills, free text saves, a failed fetch while offline leaves a plain input, other-licence group, auto-filled Eligibility (edit it, then it stays), review list.
- **Tony's real-device smoke test (only these):** iOS Scan Text appears in the Address input and the "Scan card text" box on his iPhone and iPad; the suggestion list does not hide behind the keyboard.

## 9. Questions — decided by Tony 2026-10-11

| # | Question | Decision |
|---|---|---|
| Q1 | Overseas/interstate licence removes the learner-licence wait? | **Confirmed by Tony with the authority (2026-10-11).** The reminder is plain, labelled "school rule, confirmed by Tony" (D13). |
| Q2 | Which licences count? | **Corrected by Tony 2026-10-11:** interstate learner (its time counts towards the 12/6-month wait); interstate full and overseas full (any country) held 12 months remove the wait; overseas learner does **not** count (D11, D13). |
| Q3 | "Held 1 year" from? | Default: the first issue date if known, otherwise the issue date on the card. |
| Q4 | Must the other licence be current on the drive date? | **No.** Expiry is information only; held = issue date to drive date ≥ 12 months. |
| Q5 | Does an interstate learner licence count? | **Yes** (Tony's correction): its time counts like ACT learner time. An overseas learner licence does not count. |
| Q6 | PDF Eligibility box | **Auto-filled** `C23 from YYYY-MM-DD`, only while the field is empty or generated; never overwrites Tony's text; visible and editable in the form (D18). |
| Q7 | Show the date when estimated? | Default: yes, with "≈" (PDF "~"). |
| Q8 | More NSW places? | No: the 11 listed. |
| Q9 | Street names | Abbreviations ("Av"). |
| Q10 | AI scan / paid services | **Free options only:** P5 not planned; Places APIs rejected. |
| Q11 | Keep licence photos? | No. |

**No open questions remain.** Assumptions to watch, each changeable with one word from Tony:

- A "full licence" means a full **car** licence (class C or the overseas equivalent).
- An interstate provisional (P) licence, or a motorcycle-only licence, is class `other` and does not count.
- Interstate learner time is assumed continuous into the ACT licence; there is no gap check.

## 10. Risks

- The school rule is not in the instruments (§1); it rests on Tony's confirmation with the authority. The reminder text names it as a school rule so an auditor can see where it comes from.
- G-NAF goes stale for new streets. The yearly rebuild (D10) handles this, and free text always works.
- A picked suggestion may carry a wrong house number. Numbers are not verified, and the UI hint says so.
- Live Text availability depends on the device and iOS version. Without it, Tony types or pastes as today.
- Auto-filled Eligibility: a generated value that Tony edits by one character becomes his own text and stops refreshing. This is intended (never overwrite him); clearing the field restores auto-fill.
