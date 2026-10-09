# Assessment-rules reminders + learner data Phase 2 — design

_Date: 2026-10-10 · Status: **APPROVED by Tony (2026-10-10)**, with all defaults and D21 · No code,
no migration yet · Based on `origin/staging` 7a4f7a0._

## 中文摘要（给 Tony）

**已批准（2026-10-10）**：全部默认值；Q6 改为新决定 D21。

1. 只做**提醒**，永远不阻止保存课程（你的规则）。数据缺失时只显示中性提示“补充 X 才能检查”，绝不显示假的“通过”。
2. R1 36 小时：按课程的日期+结束时间（堪培拉时间）计算“1-17/1-22 完成”的时刻，不用数据库写入时间（History Edit 会改写它）。今天就能算，不需要新字段。
3. R3 Competency 23 时间窗：周一到周四、周六 07:00-19:00，周五 07:00-21:00，周日和 ACT 公众假日不行。假日用仓库里的一张小表（2026-2027），超出范围时提示“请手动核对”。
4. R5 学习驾照有效：用已有的 licence expiry，今天就能算。
5. R2 Competency 23 资格：**今天无法计算**，需要新字段：学习驾照签发日期（可选）、（可选）首次签发日期、HPT 通过日期、学员日志小时数及其日期。
   D21：签发日期留空时，用驾照到期日减 5 年**估算**，结果一律标注“estimated from the licence expiry”；阈值在估算日期前后 14 天内会翻转时显示“borderline, check the licence card”，绝不显示通过。手填日期优先。
6. R4 已改：ADI Audit 预约现在在网上做，App 只显示一个链接“Book the Competency 23 drive with ADI Audit (ACT online form)”，旁边一行提示“至少提前 1 个完整工作日、书面”。不生成文本、不存任何预约信息。
7. 提醒出现在：Start Lesson 面板（下一步相关的最多 3 行）、课程表单（选了 Review / 23 作为 Assessed 时，保存前）、学员摘要（R5）。
8. Migration 0009 只加可为空的列；学员编辑表单增加一个可折叠的“Competency 23 eligibility”区；修订快照包含新字段。
9. ACTGDS 合同不变（hash 不变），新数据不发给 ACTGDS，不存邮箱。
10. 分两个小任务：T1 = R1/R3/R5 + 预约链接（无 migration）；T2 = migration 0009 + 新字段 + R2。
11. 每个决定都编号 D1-D21，已按推荐默认值批准。
12. 开放问题 Q1-Q9 已回答：Q1-Q5、Q7-Q9 用默认值（Q9：先重试抓取假日，仍被拦再由你粘贴）；Q6 → D21。

## 1. Verification note

I read both instruments directly from legislation.act.gov.au on 2026-10-09
(NI2020-703 PDF, 38 pages; DI2020-294 PDF, 14 pages). The quotes below are
verbatim from those PDFs. The ACT public-holiday pages returned HTTP 403 from
this environment, so **no holiday dates were verified**; see D16 and Q9.
Correction for `docs/ACT_ASSESSMENT_STANDARDS.md`: R5 is also in CoP **9 a and c**
(not only the NI2020-703 note). Before any UI wording quotes a rule, the
implementer re-checks the text against the instrument (the instruments win).

## 2. Rules in scope (exact text)

| Rule | Exact text | Source |
|---|---|---|
| R1a | "Review 1 shall be conducted not less than 36 hours after competencies 1 to 17 have been completed." | NI2020-703 Sch 1, Review 1, Performance |
| R1b | "Review 2 to be conducted not less than 36 hours after the student completes competencies 1 to 22." | NI2020-703 Sch 1, Review 2, Performance |
| R2 | Old learner licence: "aged at least 16 years and 350 days … who has held a learner licence for at least five and a half months." New, under 25 when issued: "100 required driving hours, having held the new learner licence for at least 12 months, successfully completed the hazard perception test and at least 17 years of age". New, 25+ when issued: "50 required driving hours, … at least 6 months, … hazard perception test". "Old learner licence means a learner licence in force immediately before 1 January 2020 but does not include a learner licence renewed on or after 1 January 2020." "New learner licence means a learner licence or renewed learner licence issued on or after 1 January 2020." | NI2020-703 Sch 1, Competency 23; CoP 9.2 k–l |
| R3 | "may only be conducted and completed between the hours of 7:00am and 7:00pm Monday to Thursday and Saturday and between the hours of 7:00am and 9:00pm on a Friday. … NOT to be assessed on Sundays or ACT Public Holidays." | NI2020-703 Sch 1, Competency 23 |
| R4 | "at least one clear business day prior … in writing using the booking form provided by the ADI Audit section". **Now: link only, booking is online (Tony, 2026-10-10).** | CoP 9.2 m–n |
| R5 | "Instructors must ensure that the student holds a current ACT learner driver licence before competency-based driver training and assessment is undertaken." "Students must hold a valid ACT learner licence … when undertaking driver instruction or driver assessment." | NI2020-703 preamble note; CoP 9 a, c |

## 3. Decisions (approve with one word each, or "all defaults")

### Behaviour and placement

| # | Decision | Recommended default |
|---|---|---|
| D1 | Reminders never block | Pure display. No change to `validateLessonCompetencies`, save, History Edit or the API's accept/reject logic. Amber line = "not yet / outside"; grey line = "add X to check this"; plain line = rule met per entered data. |
| D2 | Where they appear | **Start Lesson panel** (phase `ready`): at most 3 lines for the next step only (R1 when Review 1-17 / 1-22 is `ready`; R2 + R3 + booking link when 23 Final Drive is `ready`). **Lesson form**, under the competency picker, only when Review 1-17, Review 1-22 or 23 is ticked as Assessed (checked against the draft date/times, before save). **Learner summary**: R5 only. **Completed card, History**: nothing in this batch (backlog). |
| D3 | Booking link (replaces the R4 text builder) | When 23 Final Drive is `ready`, show a plain link "Book the Competency 23 drive with ADI Audit (ACT online form)" to `https://forms.act.gov.au/smartforms/servlet/SmartForm.html?formCode=1503`, `target="_blank" rel="noopener noreferrer"`, URL as ONE exported constant in `lib/rules.ts`. One-line note beside it: "Book at least 1 clear business day before, in writing (CoP 9.2 n)." Not computed, nothing stored about bookings. Re-verify the instrument text before finalising this wording. |
| D4 | Where computed | Pure functions in a new `lib/rules.ts`, run in the browser with the device clock and the data the learner detail already loads. Zero extra D1 statements. |
| D5 | Data for R1 | `computeProgress` adds `achievedLessonIds: string[]` to each `CompetencyStatus` (pure, no DB change). The client joins them to `detail.lessons` for dates/times. The ACTGDS payload maps explicit fields only (`lib/integration/contract.ts`), so it is unaffected; a test pins the schema hash. |

### Time computations

| # | Decision | Recommended default |
|---|---|---|
| D6 | Time zone | All lesson dates/times are Canberra wall-clock (they come from the device's `localNow()`). Convert to instants with IANA `Australia/Sydney` (Canberra's zone) via `Intl`, so 36 h is real elapsed time across daylight-saving changes. An ambiguous wall time (the repeated hour in April) takes the reading that is **less** favourable to a pass. |
| D7 | "1-17 completed" moment | For each competency in the set: the earliest lesson (by date + finish time) holding an Assessed + Achieved event. The set is completed at the **latest** of those. The moment is that lesson's **finish time**. Never `competency_events.created_at` (server insert time; History Edit rewrites it; paper imports carry the import time). |
| D8 | Missing finish time (paper / prior-instructor rows) | Use 24:00 of that lesson's date (latest possible) and say so: "Lesson #12 has no finish time; counted from the end of that day." Conservative: can only delay a pass. |
| D9 | Review moment | Before Start Lesson: now. In the form: the draft's date + **start** time (earliest moment the review could happen). Conservative. |
| D10 | 36 hours | Elapsed clock time (plain reading; see Q1). Allowed from = completed moment + 36 h, shown to the minute in Canberra time. |
| D11 | R3 window | Lesson date's weekday in Canberra. Start ≥ 07:00 and finish ≤ 19:00 (Fri ≤ 21:00), both on the lesson date ("conducted and completed"). Sunday or a listed holiday = outside. Missing start or finish time in the form = "add start and finish time to check the Competency 23 hours." |
| D12 | Month and age arithmetic | Calendar months, clamped **forward** (31 Aug + 6 months = 1 Mar). 5½ months = 5 months + 16 days (Q5). Birthdays on 29 Feb count from 1 Mar in non-leap years. 16 years 350 days = 17th birthday − 15 days (the instrument's own gloss). All conservative. |
| D13 | R2 evaluation date | Start Lesson panel: today. Lesson form: the draft lesson date. |
| D14 | R5 "current" | Current when `licenceExpiry` ≥ lesson date (expiry day counts as valid). Amber within 30 days before expiry. Only for `licenceStage = learner`. Missing expiry = "Add licence expiry to check the learner licence is current." |
| D15 | R2 licence type | Derived from the **current** licence issue date, or the D21 estimate when it is empty: before 2020-01-01 = old, otherwise new (this is the instrument's definition). With an estimate, D21's borderline rule applies to this cut-off too. No separate type column. |
| D16 | ACT public holidays | Committed table `lib/act-public-holidays.ts`: `{ date, name }[]` plus `coveredYears` (2026 and 2027), the source URL and retrieval date in a header comment. Source: the ACT Government public-holidays page and any holiday declared on legislation.act.gov.au. No runtime fetch. A date outside `coveredYears` gives "ACT public holidays for 2028 are not loaded; check manually." (never a pass). Update: a BACKLOG item each October adds the next year; a test checks table shape, sort order, no duplicates and that every listed date is inside `coveredYears`. No clock-dependent CI test (no time bomb). |

### Data model (T2 only)

| # | Decision | Recommended default |
|---|---|---|
| D17 | Migration 0009 | `ALTER TABLE learners ADD COLUMN` × 5, all nullable TEXT/INTEGER, no defaults, no rebuild, no backfill. Same SQL appended to `lib/schema.ts` (`SCHEMA_VERSION = 9`). |
| D18 | Fields | See the table below. `learnerLicenceIssuedOn` stays optional (D21 estimates it when empty). |
| D19 | Validation (shared `parseLearnerFields`) | New dates must be real calendar dates (not just the YYYY-MM-DD shape; the old `isoDate` gap stays for old fields: no scope creep). `learnerLicenceIssuedOn` ≤ today and ≥ `dob` when both set; `learnerLicenceFirstIssuedOn` ≤ `learnerLicenceIssuedOn`; `hptPassedOn` ≤ today; `loggedHours` integer 0–999; `loggedHoursOn` ≤ today; `loggedHours` without `loggedHoursOn` is rejected (the form fills `loggedHoursOn` with today when hours are typed, visible and editable). Edit stays strict; "" clears to null. Unchanged by D21 (the issue date stays optional). |
| D20 | Revisions and form | `LEARNER_EDIT_KEYS` gains the 5 keys, so the `learner_revisions` snapshot includes them (`json_object` in the same INSERT … SELECT; bound parameters stay 4). Old snapshots lack the keys; readers treat missing as null. The learner form (New and Edit) gets a collapsed "Competency 23 eligibility" group with the 5 fields. |
| D21 | Issue date unknown (Tony's answer to Q6, approved 2026-10-10) | When `learnerLicenceIssuedOn` is empty and `licenceExpiry` is set, R2 **estimates** the issue date as `licenceExpiry` minus 5 years, same calendar day (29 Feb → 1 Mar, as in D12), because an ACT learner licence expires 5 years after issue. Every result that uses it says "estimated from the licence expiry", never shown as exact. A typed issue date overrides the estimate. **Borderline:** evaluate the rule with the estimate moved 14 days earlier and 14 days later; if any outcome differs (old/new cut-off 1 Jan 2020, under/over 25 at issue, 5½ / 12 / 6 months held), show "Borderline, check the licence card" and never a pass. Both issue date and expiry empty: the neutral "add X" note. No new column; `licenceExpiry` already exists. Only T2 (R2) uses this; T1 needs no migration for it. Tests: estimate arithmetic (incl. 29 Feb), each threshold at ±14 / ±15 days, typed date overrides, both empty. |

| Field (camelCase / column) | Type | Needed for | Notes |
|---|---|---|---|
| `learnerLicenceIssuedOn` / `learner_licence_issued_on` | date, optional | R2 (type, months held, age at issue) | Issue date of the **current** learner licence. Empty = estimated from `licenceExpiry` (D21). |
| `learnerLicenceFirstIssuedOn` / `learner_licence_first_issued_on` | date, optional | R2 (age band if renewed, Q3) | Blank = not renewed (same as current). |
| `hptPassedOn` / `hpt_passed_on` | date | R2 (new licence) | Null = not recorded, never "not passed". |
| `loggedHours` / `logged_hours` | integer | R2 (new licence) | The learner's logbook total as the instructor reads it. Never computed from this app's lessons (Q4). |
| `loggedHoursOn` / `logged_hours_on` | date | R2 | "As of" date shown with the hours. |
| existing `dob` | date | R2 age | Already stored. |
| existing `licenceExpiry` | date | R5; R2 via the D21 estimate | Already stored. |

Not added: licence type (derived, D15), licence number/address for booking
text (R4 dropped), email (never stored here).

**Computable today:** R1 (with D8 for lessons without times), R3 (once the
holiday table exists), R5. **Not computable today:** R2 — it needs at minimum
`hptPassedOn`, `loggedHours` (+ `loggedHoursOn`), plus `learnerLicenceIssuedOn`
or, failing that, `licenceExpiry` for the D21 estimate.
Until then the Start Lesson panel says "Add licence issue date, HPT and logged
hours to check Competency 23 eligibility."

R2 result logic (`checkFinalDriveEligibility(learner, onDate)`): any input
missing (issue date counts as present when D21 can estimate it) → grey "add X"
listing exactly the missing fields; with an estimated issue date, D21's label and
borderline rule apply to every condition below; type old → age ≥
16y350d and held ≥ 5½ months (from first issue if given, else current);
type new → age band from age at issue: if first-issued and current-issued give
**different** bands, grey "Age band unclear for a renewed licence: check the
instrument" (no pass); under 25 → hours ≥ 100, held ≥ 12 months (from the
current issue date, D12), HPT set, age ≥ 17; 25+ → hours ≥ 50, held ≥ 6
months, HPT set. Each unmet condition is listed with the date it will be met
where computable.

## 4. Wording (English, one or two lines)

| Case | Text |
|---|---|
| R1 wait | "Review 1-17 allowed from Thu 8 Oct, 03:40 (36 h after Lesson #12)." |
| R1 met | "Review 1-17: 36 h rule met (1-17 completed in Lesson #12, Tue 6 Oct 15:40)." |
| R1 in form, too early | "This Review 1-17 starts within 36 h of Lesson #12 (allowed from Thu 8 Oct, 03:40). You can still save." |
| R1 no time | add: "Lesson #12 has no finish time; counted from the end of that day." |
| R3 panel | "Competency 23 hours today (Fri): 07:00–21:00." |
| R3 outside | "Competency 23 must run 07:00–19:00 Mon–Thu/Sat (Fri to 21:00). This lesson: 18:10–19:20." |
| R3 Sunday / holiday | "Competency 23 is not allowed on Sundays." / "…on ACT public holidays (Canberra Day)." |
| R3 table range | "ACT public holidays for 2028 are not loaded; check manually." |
| R2 missing | "Add licence issue date, HPT and logged hours to check Competency 23 eligibility." |
| R2 not yet | "Competency 23 not yet: 82 of 100 logged hours (as of 3 Oct); licence held 12 months on 15 Nov 2026." |
| R2 met | "Competency 23 eligibility met per entered data (new licence, under 25 at issue)." |
| R4 | link "Book the Competency 23 drive with ADI Audit (ACT online form)" + "Book at least 1 clear business day before, in writing (CoP 9.2 n)." |
| R5 | "Learner licence expired 3 Oct 2026: check a current ACT learner licence before training." / "Learner licence expires 21 Oct 2026 (12 days)." / "Add licence expiry to check the learner licence is current." |

## 5. Privacy and ACTGDS

No contract change: schema hash stays
`c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6` (an
existing alignment test plus a new assertion that `achievedLessonIds` never
appears in the payload). The new learner fields stay in Instructor Assistant
and are never put in the outbox. Editing them emits no event. Emails are never
stored. No booking data is stored. Tests and QA use synthetic `QA …` learners
only.

## 6. D1 budget

T1: zero new statements (pure client computation). T2: `createLearner` INSERT
binds 11 → 16 parameters; `updateLearner` stays 5 statements (UPDATE binds ≤ 16);
learner GET unchanged (the new columns come with the existing `SELECT`). The
budget test gets assertions for create/edit with all new fields set.

## 7. Testing

- `tests/rules.test.ts`: table-driven cases written from the rule text, fixed
  clock (`now` passed in, never `Date.now()` inside `lib/rules.ts`). R1: exactly
  36 h minus 1 minute / exactly 36 h; DST start (Oct) and end (Apr) across the
  window; missing finish time; a competency re-achieved later (earliest
  counts); History-edited lesson date moves the moment. R3: 06:59 / 07:00,
  19:00 / 19:01, Fri 21:00, Sunday, a listed holiday, a year outside the
  table. R2: each branch on its boundary day (17th birthday, 16y350d, 12 months
  and 6 months clamp, 100 / 99 hours), renewed licence with differing bands,
  each missing field. R5: expiry today, yesterday, in 30 / 31 days, missing.
- `computeProgress` test for `achievedLessonIds`; integration payload test
  (hash unchanged, no new keys).
- T2: migration test (0001..0009 concatenated equals `SCHEMA_SQL`), learner
  create/edit validation, revision snapshot holds the new fields, D1 budget.
- `qa-browser` at 375px: reminders on the Start Lesson panel, in the form with
  Review 1-17 / 23 ticked (and Save still works), the booking link opens in a
  new tab, the eligibility group in the learner form, no horizontal scroll.

## 8. Tasks and rollout

| Task | Content | Migration |
|---|---|---|
| T1 | `lib/rules.ts` (R1, R3, R5), holiday table, `achievedLessonIds`, booking-link constant, UI lines (D2), tests, qa-browser | none. **Implemented on branch `feature/rules-reminders-t1` (2026-10-10), not merged.** Holiday table derived from the Holidays Act 1958 s 3 + NI2026-154 + NI2026-387 (the ACT Government page stayed HTTP 403); cross-check it against that page at the next yearly update. |
| T2 | Migration 0009, 5 learner fields, validation, form group, revision snapshot, R2 in `lib/rules.ts` + UI, tests | 0009. **Implemented on branch `feature/rules-reminders-t2` (2026-10-10), not merged; apply 0009 to Staging D1 first.** |
| (later) | History markers for past reviews inside 36 h; yearly holiday update | — |

Each task: feature branch → typecheck, `npm test`, build, qa-browser, Memory
Guard, independent review → (T2 only) apply 0009 to Staging D1 with the
`Staging D1 Migrate` workflow (`ref` = the branch, `confirm` = `staging`)
**before** merging → merge to `staging` → Tony's phone check → `main` →
`Production Release` workflow (applies 0009 with a recorded D1 restore point).
Standing authorizations (AGENTS.md §14) cover these steps. Tony's manual
step: none beyond the phone check, unless Q9 needs him to paste holiday dates.

## 9. Open questions for Tony (defaults already chosen to be conservative)

**Answered 2026-10-10:** Q1–Q5 and Q7–Q9 accepted with the defaults below
(Q9: the builder retries fetching the ACT holiday dates; if still blocked, Tony
pastes the list). Q6: the issue date is on neither the card nor the logbook →
D21.

| # | Question | Default until answered |
|---|---|---|
| Q1 | Is "36 hours" elapsed clock time (not hours of tuition)? The text says "not less than 36 hours after … completed". | Elapsed clock time. |
| Q2 | Does "completed" mean the end of the lesson where the last competency was achieved? The instrument gives no time-of-day rule. | Lesson finish time (D7), end of day if no time (D8). |
| Q3 | Renewed new licence: do the 12 / 6 months run from the renewal or the first learner licence? Is "aged under 25 when issued" the first or the renewed licence? | Months from the current licence (later date); differing age bands = "unclear", no pass. |
| Q4 | "Required driving hours": does Tony enter the logbook total exactly as the logbook states (including any credit for ADI lessons or night hours)? The instrument does not define them; the app does not compute them. | Instructor enters the logbook figure. |
| Q5 | "Five and a half months": 5 months + 15 or 16 days? (Practically moot: an old licence not renewed since 2019 has most likely expired.) | 5 months + 16 days. |
| Q6 | Does the ACT learner licence card (or the logbook) show the issue date, so Tony can fill `learnerLicenceIssuedOn`? | **Answered: no → D21** (estimate from expiry). |
| Q7 | R3 "conducted and completed between": both start and finish inside the window? | Yes, both. |
| Q8 | "One clear business day": the CoP does not define it here, so the app only shows the note and computes nothing. OK? | Note only. |
| Q9 | ACT holiday dates for 2026–2027 could not be fetched from this environment (HTTP 403). The T1 implementer retries; if still blocked, may Tony paste the official list or link once? | Retry first; ask only if blocked. |
