# Learner intake: address suggestions, overseas/interstate licence, Competency 23 date, licence scan — design

_Date: 2026-10-11 · Status: **DESIGNED, waiting for Tony's decisions (§9) and go per phase** (no code yet) ·
Based on `origin/staging` 6c8df98 · Builds on the rules engine
(`2026-10-10-rules-reminders-and-learner-phase2-design.md`: D1 reminders never block, D12 month
arithmetic, D21 issue date estimated from expiry) and the route design
(`2026-10-11-competency-23-route-design.md`: D3 home district from the address, `lib/act-suburbs.ts`)._

## 中文摘要（给 Tony）

1. **地址自动提示**：推荐用**打包在 App 里的静态街道表**（来自政府开放数据 G-NAF，ACT + Queanbeyan/Jerrabomberra/Googong 一带，约 7,900 条“街道+区+邮编”，压缩后约 50 kB）。不需要新服务、不需要密钥、不把学员地址发给第三方、离线也能用。门牌号照你打的保存，不核对。选中提示时同时存“区/州/邮编”，这样 Competency 23 的“家所在区”判断就准确了。你的例子“44 Apple Av, Acton”**不是真实街道**（Acton 没有 Apple 开头的街；最接近的是 Jacka 的 Appleford Av）。Google/Mapbox 要你设密钥、付费账户，还会把学员地址片段发到国外；OSM Nominatim 公共服务**明令禁止**做自动提示。
2. **海外/外州驾照**：学员资料加“是否持有海外或外州驾照”，选“是”再填：驾照号、州或国家、类型（学习/P/正式）、签发日、到期日。**重要：两份 ACT 文件（NI2020-703、DI2020-294）都没有“持海外/外州驾照满一年即免等待期”的规定**。ACT 法规（Driver Licensing Regulation）里有相关但不同的规则（外州学习驾照时间可计入、某些驾照持有人可免资格要求、RTA 可个别豁免），都是 RTA 发 P 牌时的决定，不是教练做 Competency 23 时的判断。所以你的规则先标为“学校规则，请向 Access Canberra 确认”；确认前，App 不会因此显示“已满足”，只显示灰色提示（永不阻止保存）。小时数（100/50）和 HPT 仍按文件要求。
3. **“Competency 23 最早日期”**：自动算：25 岁前签发 = 签发日 + 12 个月（且满 17 岁），25 岁及以上 = + 6 个月；签发日空时用到期日 − 5 年估算并标“约”。显示在学员面板和编辑表单。PDF 的 Eligibility 栏**不自动改**，只在表单里给一个“填入”按钮，且永远不覆盖你自己写的内容。
4. **拍照识别驾照**：第一步用 iPhone/iPad 自带的“扫描文本”（Live Text，手机本地识别，不上传），App 再把识别出的文字解析成建议值，你逐项确认。第二步（可选）用 Claude 读照片：需要你批准新服务、亲自设置 API 密钥；每次约 0.03 美元；照片只在内存处理，不存、不记日志。**建议不保存任何证件照片。**
5. 分 4 个小任务，最小的先做（P1 只做第 3 项，无 migration）。ACTGDS 合同不变（hash 不变），新数据不发给网站。§9 的问题都有推荐默认值，回一句“全部默认”即可。

## 1. What the instruments say about overseas / interstate licences (verified 2026-10-11)

Read with `pdftotext -layout` from NI2020-703 (38 pp) and DI2020-294 (14 pp) in the session scratchpad,
plus the current Road Transport (Driver Licensing) Regulation 2000 (SL2000-14, republication R83,
effective 13 Jun 2026) and Act 1999 (A1999-78, R43) downloaded from legislation.act.gov.au the same day.
Page = printed page.

| # | Text (verbatim) | Source |
|---|---|---|
| L1 | "If the student holds a new learner licence Competency 23 may only be undertaken by a student: o after completing their 100 required driving hours, having held the new learner licence for at least 12 months, successfully completed the hazard perception test and at least 17 years of age, if the student was aged under 25 when issued with their learner licence; o after completing their 50 required driving hours, having held the new learner licence for at least 6 months, successfully completed the hazard perception test, if the student was aged 25 or older …" "A new learner licence means a learner licence or renewed learner licence issued on or after 1 January 2020." | NI2020-703 Sch 1, Competency 23, p 36 |
| L2 | "Students must hold a valid ACT learner licence (or an otherwise applicable licence as advised by Access Canberra) when undertaking driver instruction or driver assessment." | CoP (DI2020-294) 9 c, p 9 |
| L3 | Booking must include "The student's ACT learner licence number (or licence details as applicable)". | CoP 9.2 n ii, p 11 |
| L4 | "Student means a person who has been granted a learner driver licence or a learner driver licence receipt, in relation to a car licence." | CoP 2 (definitions), p 4 |
| R1 | Provisional car licence eligibility: "(b) the person has at any time held a learner car licence for— (i) if the person was 25 years old or older at the time the licence was issued or renewed—6 months; or (ii) in any other case—12 months"; (c) 50 h incl. 5 h night / 100 h incl. 10 h night; (d) HPT "(i) in accordance with section 23; or (ii) under the law of another jurisdiction". | Regulation s 22 (3), pp 27-28 |
| R2 | "learner licence means an Australian driver licence issued to a person under the law of any jurisdiction …"; "Australian driver licence" includes a learner licence "issued under the law of another jurisdiction". | Act, Dictionary, pp 48-49 |
| R3 | In working out the period a licence has been held, the RTA must count every period the person held an Australian driver licence "(or an external territory driver licence or a foreign driver licence issued under the law of a recognised country corresponding to an Australian driver licence of a particular class or kind)", excluding suspension/disqualification. | Regulation s 68 (1), p 66 |
| R4 | "A person is exempt from the eligibility requirements for a class of licence applied for if the person holds, or has at any time held— (a) an Australian driver licence (other than a learner licence) of that class or a higher class; … (c) a foreign driver licence issued under the law of a recognised country that corresponds to that class or a higher class." | Regulation s 66A, pp 64-65 |
| R5 | The RTA may, "because of a person's special circumstances", exempt a person from s 22 (3) (a), (b) or (c) "(other than (c) (i))". | Regulation s 67 (1), p 65 |
| R6 | "recognised country … means a country listed as a recognised country by Austroads". | Regulation s 141, p 201 |

**Conclusion.** Neither NI2020-703 nor the CoP mentions overseas or interstate licences, and neither has
any exemption from the Competency 23 eligibility conditions. The words "overseas", "interstate" and
"foreign" do not occur in either instrument. The Regulation (R1-R6) governs the **RTA's** decision to issue
a provisional licence, not the instructor's Competency 23 eligibility check. Read with the Act's definition (R2),
it suggests that time on an **interstate learner** licence counts towards "held a learner car licence"
(R1, R3). Recognised-country foreign licences count under R3. A full or provisional interstate licence
or a recognised-country licence of the class exempts the person from eligibility altogether (R4),
and other cases need an individual RTA exemption (R5). **Tony's rule ("an overseas or interstate
licence held ≥ 1 year removes the 12/6-month learner wait for Competency 23") is not in the
instruments.** It is recorded as **Tony's school rule, to be confirmed with Access Canberra (ADI Audit)**
(Q1). The instruments have no exemption from the **hours (100/50) and HPT**, so the app keeps
checking them. Under R1 (d)(ii), an HPT passed in another jurisdiction counts, so the existing
`hptPassedOn` takes that date.

## 2. Decisions

### Feature 1: address suggestions

| # | Decision | Recommended default |
|---|---|---|
| D1 | Source | **Option (a): a static, bundled street index built from G-NAF** (Geoscape, on data.gov.au; quarterly releases, Aug 2026 current). Licence: Open G-NAF EULA = CC BY 4.0 plus one use restriction (no generating addresses for **sending mail** without a second-source check). This app sends no mail, so the restriction does not apply. Attribution line in the app's About/footnote and in the data file header. |
| D2 | Coverage and size (measured 2026-10-11 from the Aug 2026 release) | Every non-retired ACT street locality with at least one address (6,953) + all streets of 11 nearby NSW localities: Queanbeyan, Queanbeyan East, Queanbeyan West, Karabar, Crestwood, Greenleigh, The Ridgeway, Jerrabomberra, Googong, Tralee, Royalla (983). Total **7,936 street + suburb + postcode entries**, 146 localities. Compact JSON 177 kB, **48 kB gzipped**. ACT postcodes come from G-NAF address details (most common per street); NSW postcodes from a short committed table (Jerrabomberra 2619, the others 2620), which the build re-checks against NSW address details. |
| D3 | Delivery | `public/data/streets-<gnaf-release>.json` (hashed name, `Cache-Control: immutable`), fetched on first focus of the Address field, then held in memory. It is a static asset, so no Worker CPU, no D1 and no new infrastructure. If the fetch fails or the device is offline before the first load, the field works as a plain text input. |
| D4 | Matching (pure, `lib/address-suggest.ts`) | Query = optional unit/number token kept **as typed** (`44`, `3/44`, `44A`), then word-prefix match on the street name, optionally followed by a suburb prefix ("44 app", "44 appleford ja"). At most 5 results: exact-prefix first, ACT before NSW, then alphabetical. Display uses Australia Post abbreviations in title case: "44 Appleford Av, Jacka ACT 2914". House numbers are **never verified**. A per-address index (≈278,000 ACT addresses, roughly 1-2 MB more) was considered and rejected. |
| D5 | Tony's example | "Apple Av, Acton" **does not exist** in G-NAF: Acton has 30 streets and none starts with "Apple". "44 app" would offer Appleford Av (Jacka ACT 2914), Applebox Pl (Jerrabomberra NSW) and Appleberry Rd (Tralee NSW). |
| D6 | UI (iPhone/iPad Safari) | Custom listbox under the existing Address input (not `<datalist>`, which cannot rank number-prefixed queries). Rows ≥ 44 px, at most 5, tap fills the text and keeps the keyboard. "×" or blur closes it. The input keeps `type="text"` and is never `readonly`, so iOS Scan Text still works (D19). Suggestions start after 3 typed letters of the street. Free text always saves, with or without a pick, and an unmatched address never warns. |
| D7 | Structured fields | New nullable `address_suburb`, `address_state`, `address_postcode`, set **only when a suggestion is picked**. If the address text is edited afterwards, the form keeps them only while the text still contains the suburb as a whole word; otherwise it clears them. The server validates their shape (suburb ≤ 60 chars, state ∈ ACT/NSW/VIC/QLD/SA/WA/TAS/NT, postcode 4 digits) and checks that the suburb appears in the address text. It does not need the index. |
| D8 | Route design link | R10's `homeDistrict()` uses `address_suburb` when set (exact, evidence "from the picked suburb Florey"). Otherwise it falls back to the D3 text derivation. The G-NAF ACT locality list is also used to check the §2a suburb table in the route design. |
| D9 | Rejected options | **(b) Google Places Autocomplete (New)**: as read on Google's pricing page on 2026-10-11, Autocomplete Requests have 10,000 free per month, then USD 2.83 per 1,000. It needs a Google Cloud billing account, an API key secret set by Tony, a Worker proxy route, new-service approval, and Google's display and caching terms. It sends partial learner addresses to Google. **Mapbox Search Box**: about 500 free sessions per month, then about USD 11.50 per 1,000 as read from its pricing page; the same key, approval and PII issues apply. **Geoscape Predictive**: commercial, pricing not checked. All prices must be re-checked before any decision. **(c) OSM Nominatim public instance**: its usage policy says "Auto-complete search … you must not implement such a service" (strictly forbidden, ban). It also has a maximum of 1 request per second and ODbL share-alike terms. A self-hosted Nominatim would be new infrastructure. |
| D10 | Updates | `scripts/build-street-index.mjs` (Node, run by an agent, not in CI) reads the G-NAF PSV files for ACT and the listed NSW localities and writes the JSON with a header naming the release and the attribution. A yearly BACKLOG item (next to the holiday table) adds new streets in new suburbs (e.g. Whitlam, Sulman). The script can range-read only the needed files out of the 1.85 GB national ZIP, as done for this design. |

### Feature 2: overseas / interstate licence

| # | Decision | Recommended default |
|---|---|---|
| D11 | Fields (New and Edit learner form, a collapsed group "Overseas or interstate licence") | `other_licence_kind`: NULL = not recorded, `none`, `interstate`, `overseas` (the yes/no; "Yes" opens a choice of interstate or overseas). Then `other_licence_place`: an Australian state or territory code (not ACT) for interstate, or a country name for overseas (suggested from a bundled English country list, free text allowed). Then `other_licence_number` (≤ 40, uppercase), `other_licence_class` (`learner`, `provisional`, `full`, or NULL), `other_licence_issued_on` and `other_licence_expires_on`. All are optional, and nothing blocks a save. |
| D12 | Validation (shared `parseLearnerFields`, strict on edit, cross-field rules only when a touched key is involved, same as the 0009 D19 rules) | Dates must be real calendar dates. Issued must be ≤ today and ≥ `dob`. Expiry must be ≥ issued. The place must be valid for the kind (a state code for interstate, ≤ 60 characters for overseas). Choosing "No" clears the detail fields; the old values stay in the revision history. |
| D13 | R2 integration (`finalDriveEligibilityReminder`) | Applies only when the kind is interstate or overseas, the other licence is **current** on the check date (Q4), and it has been held ≥ 12 months by then (D12 month arithmetic, from `other_licence_issued_on`). In that case the "licence held 12/6 months" condition is replaced by the line "learner-licence wait not applied: school rule for an overseas/interstate licence held 1 year (NSW, since 3 Mar 2025); confirm with Access Canberra". Hours, HPT and age are still checked as today. **Tone until Q1 is answered: grey** ("not checked"), never plain. After Tony confirms, the one constant `OTHER_LICENCE_WAIVES_WAIT = true` makes the result plain, still labelled "school rule". If the issue date is missing, grey: "Add the overseas/interstate licence issue date to check the school rule". If the licence is held < 12 months, the normal ACT wait applies, plus a note giving the date the school rule would apply. An expired other licence means the normal rule applies, with a note. |
| D14 | Revisions | All new keys join `LEARNER_EDIT_KEYS` (the snapshot is the same `json_object`, still 4 bound parameters). Revision labels are added. Old snapshots lack the keys, which read as null. |
| D15 | PDF | **Nothing new prints.** The official checklist header has no field for it. The ACT learner licence stays in "Licence number". Tony can still write a note in "Eligibility" by hand. |
| D16 | Photo of the licence | No photo is stored. "Photo capture" here means the scan helpers (D19/D20) filling these fields. Storing images is rejected (D22). |

### Feature 3: "Competency 23 eligible from"

| # | Decision | Recommended default |
|---|---|---|
| D17 | Computation (pure `finalDriveEligibleFrom(learner)` in `lib/rules.ts`, reusing `evaluateEligibility`'s per-condition "met on" dates) | Result = the latest of the date conditions. **New licence, under 25 at issue:** issue + 12 months, and the 17th birthday. **25+:** issue + 6 months (Tony's wording = L1). **Old licence (issued before 1 Jan 2020):** 5 months + 16 days held (from first issue if given), and 16 years 350 days of age. Hours and HPT have no date, so they are listed as "plus 100 logged hours and HPT", or not listed when already met per entered data. With the D21 estimate, the date is shown "≈" with the ±14-day range ("about 15 Nov 2026, between 1 and 29 Nov"). If DOB is missing or the bands differ for a renewed licence, the result is grey with the reason. When the school rule (D13) applies, the date line shows the school-rule wording instead. |
| D18 | Where | (1) Learner panel summary, one line for the learner stage only: "Competency 23 from 15 Nov 2026 (licence 12 months; plus 100 h and HPT)". (2) Inside the Edit/New form's "Competency 23 eligibility" group, read-only and live while typing. (3) **PDF Eligibility field: not auto-filled.** A "Fill" button next to the Eligibility input writes `C23 from 2026-11-15` (or `C23 ~2026-11-15` when estimated). The button is enabled only when the field is empty or still equals a previously generated value (regex `^C23 (from \|~)\d{4}-\d{2}-\d{2}$`), so Tony's manual text is never overwritten. Nothing changes silently later. A test checks the string fits the 94-pt box at 8 pt (`lib/pdf-layout.ts`). ISO dates match the other PDF header dates. |

### Feature 4: licence scan

| # | Decision | Recommended default |
|---|---|---|
| D19 | Phase 1: iOS Scan Text (Live Text) | On-device, free, nothing leaves the phone. Live Text is iOS/iPadOS 15+ on A12-or-later devices; Tony taps a text field, then "Scan Text" in the callout menu. It works only in editable text fields: `type="date"` opens a picker, so dates cannot be scanned straight in. The app adds a "Scan card text" textarea at the top of the New/Edit form (plain `<textarea>`, not readonly, no custom key handling). Tony scans the whole card into it, or pastes text copied from a photo in Photos. A pure local parser `parseLicenceText()` proposes name, DOB, licence number, expiry and address, plus the other-licence fields. The values appear as a review list with "Use" toggles, and nothing is written until Tony applies and then saves. The textarea is never saved. Whether Scan Text appears in Safari web inputs on Tony's iPhone and iPad is a **real-device check** (§13). |
| D20 | Phase 2: AI extraction (off by default) | `POST /api/licence-scan` on the existing Worker (Access-gated like every API route). The client downscales to ≤ 1568 px JPEG (≤ 1.5 MB, front side only) and sends it to the Claude API with `@anthropic-ai/sdk`, model `claude-opus-5-5` (Q10), `output_config.format` JSON schema (each field: value, confidence high/medium/low) and `output_config.effort: "low"`, with the server-side refusal `fallbacks: "default"`. The **image is processed in memory and never stored**. No D1 write, no R2, and no logging of the image, the extracted values or the response body (errors log the status code only). The same review list as D19, each field shown against the current value, nothing pre-ticked for low confidence. Enabled only when the env var `LICENCE_SCAN_ENABLED=1` and the secret `ANTHROPIC_API_KEY` (set by Tony in the Cloudflare dashboard, never in chat or git) are present; otherwise the button is hidden. A spend limit is set by Tony in the Anthropic Console. |
| D21 | Consent wording (shown before the camera opens, every time) | "Ask the learner first: 'I'll photograph the front of your licence to fill in this form. The photo is sent to Anthropic (Claude, USA) only to read the text; this app does not keep it.' Continue only if they agree." The card carries the learner's portrait and licence number (a government identifier). |
| D22 | Storing photos | **Not recommended.** It would need R2 object storage (new infrastructure, Tony's approval), access control, retention and deletion rules, and handling of identity documents under the Privacy Act APPs (APP 11 security; APP 8 if stored offshore; check whether the small-business exemption applies to the school). Tony already sights the card (CoP 9 a-b), and the app records only the details. |
| D23 | Rejected: on-device OCR in the browser (Tesseract.js) | Several MB of WASM and language data on first use, slow on phones, and weak on small text over a patterned card background. Live Text is better and free. |

### Cross-cutting

| # | Decision | Recommended default |
|---|---|---|
| D24 | ACTGDS | No contract change. Schema hash stays `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6` (existing alignment test plus an assertion that no new key appears in the payload). New fields are never put in the outbox, and editing them emits no event. Address data is the learner record's existing PDF field; this design only helps type it (AGENTS.md §10). |
| D25 | Time | "Today" and every displayed date are in Canberra time (§15, `localNow`). |

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
ALTER TABLE learners ADD COLUMN other_licence_class TEXT;     -- NULL | learner | provisional | full
ALTER TABLE learners ADD COLUMN other_licence_issued_on TEXT;
ALTER TABLE learners ADD COLUMN other_licence_expires_on TEXT;
```

No defaults, no backfill, no rebuild. The same SQL is appended to `lib/schema.ts` (the `d1-storage` test
checks the concatenation). Enum checks live in `parseLearnerFields`, not in SQL `CHECK`, which would need
a table rebuild. Each migration is applied to Staging D1 before its merge (Staging D1 Migrate workflow).

## 4. D1 budget (Free plan: 500 MB per DB, ≤ 50 queries per invocation, ≤ 100 bound parameters)

| Path | Today | After |
|---|---|---|
| `createLearner` INSERT bound parameters | 16 | 25 (P2 + P3) |
| `updateLearner` statements / bound parameters | 5 / ≤ 16 | 5 / ≤ 26 |
| Revision INSERT … SELECT | 4 parameters | 4 (snapshot only grows) |
| Learner GET, panel, "eligible from", R2 | — | 0 new statements (columns come with the existing `SELECT`) |
| Address suggestions, Scan Text parser | — | 0 (static asset and pure client code) |
| AI scan | — | 0 (no D1 access at all) |

Storage: about 150 bytes more per learner row and about 250 bytes more per learner revision. For 1,000
learners with 5 edits each, that is under 1.5 MB, against the current Production DB of 324 kB and the
500 MB limit. The existing `d1-query-budget` test gains create/edit cases with every new field set.

## 5. Privacy

The address index is public data and is downloaded, so it reveals nothing about learners. Matching runs in
the browser, and no typed address leaves the device except in the normal learner save. The Scan Text
parser is local, and the textarea is never saved. The AI scan sends one image to Anthropic only after
consent (D21), with nothing stored or logged here. Tony checks Anthropic's commercial data-retention terms
before approving, and the consent text names the overseas recipient. Other-licence numbers stay in this
app only: they are never sent to ACTGDS and are not used by the duplicate-licence warning. Tests and QA use
synthetic `QA …` learners, invented licence numbers and synthetic card images or text only. No real card
is ever committed.

## 6. Costs

| Item | Cost |
|---|---|
| Static G-NAF index (D1-D10) | USD 0. About 48 kB per device, once. |
| Scan Text (D19) | USD 0, on device. |
| AI scan (D20), estimate | About 2,000-2,500 input tokens (card image about 1,600, plus prompt and schema) and about 1,000 output tokens (JSON plus low-effort thinking). On `claude-opus-5-5` (USD 4 / 20 per million) that is **about USD 0.03 per scan**; 50 scans per month is under USD 2. On `claude-haiku-5-5` (USD 0.10 / 0.50) it is under USD 0.002. Latency is estimated at 3-10 s. The implementer measures `usage` on 5 synthetic cards before the go. |
| Places APIs (rejected) | Free tiers as read 2026-10-11, then per-1,000 pricing (D9). They also need a billing account and a card. |

## 7. Phases (smallest safe slice first; each ends with a stop and a report, §11)

| Task | Content | Migration | External |
|---|---|---|---|
| **P1** | Feature 3: `finalDriveEligibleFrom`, panel line, form line, "Fill" button for Eligibility (D17-D18), tests | none | none |
| **P2** | Feature 1: `scripts/build-street-index.mjs`, committed JSON and attribution, `lib/address-suggest.ts`, listbox UI, structured suburb fields (D7), R10 uses them when R10 is built (D8) | P2 columns | none |
| **P3** | Feature 2: other-licence group, validation, R2 school rule (D13, grey until Q1), "eligible from" wording, revisions | P3 columns | none |
| **P4** | Feature 4 Phase 1: "Scan card text" textarea and `parseLicenceText` with review list (D19) | none | none |
| **P5** (only after Tony approves the service and sets the secret) | `/api/licence-scan` (D20-D21), flag off by default, cost measured | none | Anthropic API (new external service) |

## 8. Tests and QA

- `tests/rules-eligible-from.test.ts`: each band on its boundary day (12 / 6 months with forward clamp, 31 Aug + 6 months = 1 Mar, 17th birthday later than 12 months, 29 Feb birthday), old licence, estimate with range, missing DOB, renewed licence with differing bands, hours and HPT already met so not listed. "Fill" string format, fit in the PDF box, and the no-overwrite rule.
- `tests/address-suggest.test.ts` against a small synthetic fixture (the real JSON gets only a shape test: sorted, no duplicates, ACT/NSW only, 4-digit postcodes, attribution header). Cases: "44 app" gives Appleford Av first; unit "3/44" and "44A" kept; suburb narrowing; ACT before NSW; at most 5 results; no match gives an empty list. Keeping or clearing the structured fields after an edit.
- R2 school rule: held exactly 12 months and 1 day short; other licence expired; issue date missing; tone grey while `OTHER_LICENCE_WAIVES_WAIT` is false and plain (labelled) when true; hours and HPT still unmet → amber; never plain without the constant.
- Repo: create/edit validation for every new field, a touched-only cross-field rule, revision snapshot holds the new keys, migration concatenation equals `SCHEMA_SQL`, D1 budget assertions, ACTGDS payload unchanged (hash).
- `parseLicenceText` on synthetic Live-Text-like strings (dates `dd/mm/yyyy` and `dd Mon yyyy`, labels in any order, OCR noise). It proposes values and never writes on its own.
- P5: route returns 404 when the flag is off and 503 without the secret; a mocked SDK client checks that no logging includes the body and that the schema is parsed; a payload over the size limit gets 413.
- `qa-browser` at 375 px: listbox with 44 px rows and no horizontal scroll, tap fills, free text saves, offline fetch failure leaves a plain input, other-licence group, Fill button, review list.
- **Tony's real-device smoke test (only these):** iOS Scan Text appears in the Address input and the "Scan card text" box on his iPhone and iPad; the suggestion list does not hide behind the keyboard; (P5) one camera capture.

## 9. Open questions for Tony (one word each; defaults are conservative)

| # | Question | Default until answered |
|---|---|---|
| Q1 | Will you confirm with Access Canberra (ADI Audit) that an overseas/interstate licence held ≥ 1 year removes the 12/6-month learner wait for Competency 23? The instruments do not say so (§1). | Grey "not checked" line, never a pass. |
| Q2 | Does any country count, or only Austroads "recognised countries" (R3, R4, R6)? | Any country, as you said; the line names the country. |
| Q3 | "Held 1 year": from the first issue of the other licence or the date printed on the card (often a renewal)? | Ask for the first issue date; the label says "(first issued, if known)". |
| Q4 | Must the other licence still be current on the drive date? | Yes. |
| Q5 | Does an interstate **learner** licence count the same as a full one under your rule? | Yes (your rule says any licence); the class is recorded for evidence. |
| Q6 | What do you write in the PDF "Eligibility" box today? | One-tap "Fill" with `C23 from YYYY-MM-DD`, never automatic. |
| Q7 | Show "eligible from" when the issue date is estimated? | Yes, with "≈" and the ±14-day range. |
| Q8 | Nearby NSW places beyond the 11 listed (e.g. Bungendore, Murrumbateman, Yass, Sutton, Wamboin)? | Only the 11. |
| Q9 | Street names: abbreviations ("Av", "Cres") or full ("Avenue")? | Australia Post abbreviations, as in your example. |
| Q10 | Approve Anthropic as a new external service for P5, set `ANTHROPIC_API_KEY` yourself, and set a monthly spend limit? Model `claude-opus-5-5` (about USD 0.03 per scan) or the cheaper `claude-haiku-5-5`? | Not built until you approve; `claude-opus-5-5`; flag off. |
| Q11 | Keep licence photos? | No (D22). |

## 10. Risks

- The school rule may be wrong in law. That is why it shows grey until Q1 is answered and is labelled "school rule" afterwards.
- G-NAF goes stale for new streets; the yearly rebuild (D10) handles it, and free text always works.
- A picked suggestion with a wrong house number: numbers are not verified, which is stated in the UI hint.
- Live Text availability depends on the device and iOS version; Phase 1 degrades to typing or pasting.
- AI misreads: the review list is mandatory, low confidence is never pre-ticked, and nothing saves without Tony.
- Identity-document data held offshore (P5): consent each time and no storage; Tony accepts the provider's terms.
