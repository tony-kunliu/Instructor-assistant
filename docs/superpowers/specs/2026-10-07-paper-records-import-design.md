# P1b — Paper Records Import: Design

_Date: 2026-10-07 · Status: DRAFT, awaiting Tony's review · Branch:
`feature/paper-records-import`_

## 中文摘要(给 Tony)

- 目的:把 20 多位**仍在上课**的学员的纸质课程记录补录进 App,让课次、
  累计小时/公里、能力进度和 PDF 都完整接上;以后的新课继续在 App 里记。
- 方式:每位学员一个 CSV,由 Claude 根据照片整理 → Tony 核对 → Tony 在
  App 里上传 → 预览 → 确认 → 一次性全部写入(全成或全不成)。
- 只能导入到**还没有任何课**的学员(目前所有学员都满足)。
- 少数缺时间/里程的纸质课:字段留空,累计按 0 计,不手填任何派生值。
- 能力规则不放宽:每节导入课都过现有校验。
- 纸质课**永远不发**给 ACTGDS;以后 App 新课照常发。V1 合同不改。
- 邮箱、推广同意、报名表都属于 ACTGDS,不进本 App。
- 与 Release B 一起上线,Production 每一步都需 Tony 授权。

## 1. Goal and success criteria

Tony has paper CBT&A records for 20+ learners who are **still taking
lessons**. Import them so each learner's lesson numbering, cumulative
hours/km, competency progress and PDF export continue seamlessly into
lessons recorded in the App afterwards.

Success means:

1. A learner's paper lessons appear in History as lessons `1..N` in date
   order, marked as paper imports; the next App lesson is `N+1`.
2. Cumulative totals and competency progress include the paper lessons.
3. The official PDF exports paper and App lessons together.
4. Nothing about the ACTGDS Integration V1 contract changes.
5. No real learner data ever enters the git repository.

## 2. Decisions (Tony-approved, 2026-10-07)

| # | Decision |
|---|---|
| D1 | Most paper records are complete; a few lack times and/or odometer readings. Missing values are stored as NULL and count as **0** toward cumulative totals. No derived value is ever typed in. |
| D2 | Competency gates are **not** relaxed for imports. |
| D3 | Import only into a learner with **zero lessons** (true for every learner today — Production has no real customer lessons yet). |
| D4 | Paper lessons are **never** sent to ACTGDS. App lessons recorded afterwards sync normally. This replaces the earlier per-learner `integration_sync_paused` idea, which is dropped. |
| D5 | Blank signatures are allowed on paper lessons; paper originals are kept 5 years from the learner's last lesson (physical retention, no App feature). |
| D6 | Data entry: Tony photographs one learner's records → Claude transcribes to CSV → Tony verifies → Tony uploads in the App. Claude deletes the photos/CSV from its container after a confirmed import. |
| D7 | Instructor per lesson is `Tony` or `Anna` (must match an existing active instructor exactly). |
| D8 | Email addresses and promotion consent are **not** stored here; they belong in the ACTGDS CRM (AGENTS.md §10). Learners consented at enrolment. The enrolment form is an ACTGDS-side follow-up. |
| D9 | PDF signature cell for a paper-signed lesson reads `Paper original`. |

## 3. Data model — migration `0006`

Only the `lessons` table changes.

| Column | Change |
|---|---|
| `start_time`, `finish_time` | nullable |
| `start_odometer`, `finish_odometer` | nullable |
| `duration_minutes`, `distance_km` | nullable (NULL when the inputs are missing) |
| `record_source` | new, `TEXT NOT NULL DEFAULT 'app' CHECK (record_source IN ('app','paper_import'))` |
| `signature_status` | new, `TEXT NOT NULL DEFAULT 'digital' CHECK (signature_status IN ('digital','on_paper','unsigned'))` |

`cumulative_minutes` / `cumulative_km` stay `NOT NULL` (always derivable).

Invariant enforced in application code: a lesson with
`record_source = 'app'` always has every time/odometer/duration/distance
value and `signature_status = 'digital'`; only `paper_import` lessons may
have NULLs or `on_paper` / `unsigned`.

**Table rebuild.** SQLite cannot drop `NOT NULL` in place, so 0006 rebuilds
`lessons` (create `lessons_new` → copy every row with
`record_source='app'`, `signature_status='digital'` → drop `lessons` →
rename). `competency_events.lesson_id` references `lessons(id)`, so the
migration runs with `PRAGMA defer_foreign_keys = ON` (D1's documented way
to rebuild a referenced table). Every existing column (including 0003's
`updated_at` and 0004's `updated_by_instructor_id`) and the
`UNIQUE (learner_id, lesson_no)` constraint are preserved. `lib/schema.ts`
`SCHEMA_SQL` stays equal to the concatenated migrations, as the existing
test requires. Before running on Production: export a D1 backup and
compare row counts before/after.

Rollback: 0006 never deletes or rewrites existing values, so rolling the
Worker back to the previous version keeps working against the rebuilt
table **as long as no paper lesson has been imported yet** (old code only
writes complete rows, and never reads the new columns). After the first
import, old code would mis-display NULL fields, so a rollback then must
be a forward fix instead — another reason real imports wait until step 5
of §8.

## 4. Derived values with missing data

- `duration_minutes` = finish − start when both times exist, else NULL.
- `distance_km` = finish − start odometer when both exist, else NULL.
- Cumulative = previous lesson's cumulative + (value ?? 0). The existing
  `getTotals` `SUM()` already ignores NULLs.
- Odometer monotonicity (create, edit, import) compares against the
  **nearest earlier/later lesson that has a reading**, skipping NULLs.
- Next App lesson's start-odometer prefill = most recent non-NULL
  `finish_odometer`.
- History Edit of a paper lesson uses the same nullable rules; History
  Edit of an App lesson is unchanged (all fields required). The existing
  "editing invalidates signatures" rule applies only to `digital`
  signatures; a paper lesson's `signature_status` is edited explicitly.

## 5. Import flow

1. Create the learner with the existing New Learner form (unchanged).
2. On a learner with zero lessons, an **Import paper records** action is
   shown (hidden once any lesson exists).
3. Upload one CSV (UTF-8, header row) for that learner.
4. Server validates the whole file and returns a **preview**: lesson
   count, cumulative hours/km, final competency progress, lessons with
   missing data, lessons without signatures. Nothing is written.
5. On confirm, the same file is re-validated and written in **one
   `db.batch()`** — all lessons + competency events commit together or not
   at all. The batch re-checks "learner still has zero lessons".
6. Any error rejects the whole file with per-row messages
   (e.g. `Row 7: finish time is before start time`).

### CSV columns

| Column | Required | Format |
|---|---|---|
| `date` | yes | `YYYY-MM-DD` |
| `start_time`, `finish_time` | optional (both or neither) | `HH:MM` |
| `start_odometer`, `finish_odometer` | optional (both or neither) | whole km |
| `taught` | optional | competency ids separated by `;` (e.g. `1;2;3`) |
| `assessed_achieved` | optional | ids assessed and achieved |
| `assessed_not_achieved` | optional | ids assessed, not achieved |
| `location`, `comments` | optional | text (existing length limits) |
| `signature` | yes | `on_paper` or `unsigned` |
| `instructor` | yes | `Tony` or `Anna` |

Special assessment ids use the App's own tokens (`review-1-17`,
`review-1-22`, `final-drive-23`). Rows must be in chronological order
(same-date rows keep file order); lesson numbers, durations, distances and
cumulative values are never in the file. The CSV contains no learner
identity fields; any extra column (such as Tony's own email column) is
**rejected**, so personal data cannot slip in by accident — Claude's
generated CSVs never include it.

### Validation (per row, in order)

Each row runs through the **same** rules as an App lesson:
`validateLessonCompetencies` against progress accumulated from the earlier
rows (D2), plus the chronology checks already used by History Edit. A
learner already `completed` stops further rows. Field rules: valid date,
times/odometers paired and ordered, odometer monotonic across rows,
instructor resolves to an active instructor.

### API

`POST /api/learners/:id/import` with `{ csv, mode: "preview" | "commit" }`,
behind Cloudflare Access like every other route. Parsing and validation
live in a new pure module `lib/paper-import.ts` (no DB access, unit
tested); `lib/repo.ts` gets one `importPaperLessons` function that builds
the batch.

## 6. Display and PDF

- History list/detail: a `Paper record` badge; missing values show `—`.
- PDF: missing times/odometer cells blank; total cells blank when the
  lesson's own duration/distance is NULL; the per-page cumulative line is
  unchanged; signature cells show the image (`digital`), `Paper original`
  (`on_paper`), or blank (`unsigned`).

## 7. ACTGDS Integration (no contract change)

- `importPaperLessons` never enqueues outbox rows.
- `updateLesson` on a paper lesson enqueues **no** event for that lesson.
  Downstream propagation (cumulative changes) still emits events for
  downstream **App** lessons only; paper lessons are skipped. The
  per-lesson `source_updated_at` monotonicity mechanism is unchanged.
- App lessons' payloads already carry `cumulative_*` and `progress` that
  include paper data — correct, and schema-valid.
- Contract version stays `1`; schema/fixtures untouched; the
  integration-alignment tests must keep passing unchanged.
- **Notice for ACTGDS (informational, not a contract change):** for an
  imported learner, the first event ACTGDS receives may be e.g.
  `lesson_number: 16` with non-zero cumulative values and no earlier
  lessons mirrored. To be posted on `tony-kunliu/actgds.com` Issue #3 so
  the receiver confirms its display tolerates this.

## 8. Relationship with Release B (Production Integration enablement)

Built on separate branches (`feature/paper-records-import`,
`feature/release-b-production-integration`), released in **one**
Production window, each step separately authorized by Tony:

1. Backup Production D1.
2. Apply `0005` then `0006` to Production (needs a temporary token with D1
   edit permission, revoked afterwards).
3. Deploy P1b code with Integration still **disabled**; verify.
4. Enable Integration (Release B: Production webhook URL var, secret set
   by Tony directly in Cloudflare, `ACTGDS_INTEGRATION_ENABLED=true`);
   verify.
5. Only then import real learners, one at a time.

Release B depends on: ACTGDS Production receiver live, shared signing
secret configured on both sides, and the Issue #3 notice above
acknowledged.

## 9. Privacy

- Real learner data never enters git; tests and QA use synthetic `QA …`
  data only.
- One learner at a time: photos → CSV in Claude's session scratchpad →
  Tony verifies → Tony uploads → Claude deletes photos and CSV.
- Photos sent in chat remain in Tony's Claude conversation history, which
  Claude cannot delete — Tony may delete the conversation afterwards.

## 10. Testing

- Unit (`npm test`): CSV parsing/validation; NULL-aware derivation and
  cumulative totals; competency gate rejection; non-empty learner
  rejected; all-or-nothing batch (forced failure writes nothing); no
  outbox rows from import; paper-lesson edit → events only for downstream
  App lessons; odometer monotonicity skipping NULLs; PDF cells for each
  signature status; migration test (`SCHEMA_SQL` equality) and a rebuild
  test that existing rows survive 0006 intact.
- All existing tests pass unchanged, including integration alignment.
- `qa-browser` at 375px: create learner → import preview → commit →
  History badge → edit paper lesson → next App lesson numbering/prefill →
  PDF export.
- `0006` applied to local D1, then Staging D1, before Production.

## 11. Out of scope

- Email / promotion consent import into ACTGDS CRM (ACTGDS repo).
- Enrolment form draft (ACTGDS side).
- Importing into learners who already have App lessons.
- Scanning or storing photos of paper originals in the App.
- Bulk multi-learner files.
