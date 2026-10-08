# P1b Paper Records Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Tony import a learner's paper CBT&A lessons from a CSV into a learner with zero lessons, so numbering, cumulative totals, competency progress and PDF continue seamlessly into App lessons.

**Architecture:** Migration `0006` rebuilds `lessons` with nullable time/odometer/duration/distance plus `record_source` and `signature_status`. A pure module `lib/paper-import.ts` parses and validates the CSV and computes every derived value; `lib/repo.ts#importPaperLessons` writes the result in one atomic `db.batch()` with no outbox rows. History Edit, PDF and UI learn about paper lessons; the Integration contract is untouched.

**Tech Stack:** Next.js 16 / React 19, Cloudflare Workers + D1 (SQLite), `node --test` with `node:sqlite` test adapter, Playwright qa-browser harness.

**Spec:** `docs/superpowers/specs/2026-10-07-paper-records-import-design.md`

## Global Constraints

- Branch: `feature/paper-records-import` (from `origin/staging`). Never merge to `staging`/`main` without Tony's authorization.
- `npm run typecheck`, `npm test`, `npm run build` all pass before every commit.
- iPhone first: every screen works at 375px with no horizontal scroll.
- Derived values (lesson number, duration, km, cumulative) are always calculated, never typed.
- App lessons (`record_source = 'app'`) keep every existing rule unchanged: all fields required, `signature_status = 'digital'`, digital signatures required.
- `docs/integrations/lesson-upserted-v1.schema.json` and `.fixtures.json` are never edited; `contract_version` stays `1`; existing integration tests pass unchanged.
- Paper lessons never produce `integration_outbox` rows.
- No real learner data in git: tests and QA use synthetic `QA …` names only.
- Competency ids in CSV use the App's internal tokens: `1`..`22`, `review-1-17`, `review-1-22`, `final-drive-23`.
- PDF text for `on_paper` signatures: `Paper original`. History badge text: `Paper record`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session:` line.

## Review Focus

1. CSV saved by Excel: UTF-8 BOM and CRLF line endings must parse identically to plain LF UTF-8 — Task 3 test `parseCsv strips BOM and handles CRLF`.
2. Comments containing commas, quotes or Chinese text must round-trip intact — Task 3 test `parseCsv handles quoted fields`.
3. Double-tapping "Confirm import" must not create duplicate lessons — Task 4 test `second commit is rejected and writes nothing`.
4. A lesson created in the App between preview and commit must abort the import entirely — Task 4 test `commit fails atomically if a lesson appeared after preview`.
5. Editing a paper lesson must not demand signatures nor emit its own integration event, while downstream App lessons still get propagated events — Task 2 tests.

---

### Task 1: Migration 0006, schema and nullable Lesson type

**Files:**
- Create: `migrations/0006_paper_records.sql`
- Modify: `lib/schema.ts` (append the same SQL to `SCHEMA_SQL`; `SCHEMA_VERSION = 6`)
- Modify: `lib/types.ts` (`Lesson`)
- Modify: `lib/repo.ts` (`toLesson`, `getTotals`)
- Modify: compile sites that read the now-nullable fields (`app/driver-app.tsx`, `lib/pdf-export.ts`, `lib/repo.ts` integration builders) — render `null` as `—` in the UI and blank in the PDF
- Test: `tests/d1-storage.test.ts`, new `tests/paper-records-migration.test.ts`

**Interfaces:**
- Produces:
  - `type RecordSource = "app" | "paper_import"`, `type SignatureStatus = "digital" | "on_paper" | "unsigned"` in `lib/types.ts`
  - `Lesson` changes: `startTime: string | null`, `finishTime: string | null`, `startOdometer: number | null`, `finishOdometer: number | null`, `durationMinutes: number | null`, `distanceKm: number | null`, new `recordSource: RecordSource`, `signatureStatus: SignatureStatus`
  - `getTotals(...).lastFinishOdometer` = most recent **non-NULL** `finish_odometer` by `lesson_no`

- [ ] **Step 1: Write failing tests**
  - Rename the d1-storage drift test to `migrations/0001..0006 match lib/schema.ts` and add `0006_paper_records.sql` to its file list.
  - `tests/paper-records-migration.test.ts`:
    - `0006 preserves existing lessons`: build a DB from migrations 0001–0005 only (exec each file on a fresh `node:sqlite` DB), insert one learner + two complete lessons + their competency_events + one updated lesson (`updated_at`, `updated_by_instructor_id` set), exec 0006, assert every original column value is identical, `record_source = 'app'`, `signature_status = 'digital'`, competency_events still join, row count equal.
    - `0006 allows NULL time/odometer/duration/distance`: insert a lesson with those NULL → succeeds.
    - `0006 CHECK constraints`: `record_source = 'x'` and `signature_status = 'x'` both throw.
    - `0006 keeps UNIQUE (learner_id, lesson_no)`: duplicate insert throws.
    - `getTotals lastFinishOdometer skips NULL`: lessons #1 finish 120, #2 finish NULL → `lastFinishOdometer === 120`; `totalMinutes`/`totalKm` treat NULL as 0.

- [ ] **Step 2: Run** `npm test` — Expected: new tests FAIL (no 0006).

- [ ] **Step 3: Write `migrations/0006_paper_records.sql`**

  Header comment in the style of 0005. Body: `PRAGMA defer_foreign_keys = ON;` → `CREATE TABLE lessons_new (...)` with every current column (0001 columns, `updated_at TEXT`, `updated_by_instructor_id TEXT REFERENCES instructors (id)`), the six columns above without `NOT NULL`, plus
  `record_source TEXT NOT NULL DEFAULT 'app' CHECK (record_source IN ('app', 'paper_import'))`,
  `signature_status TEXT NOT NULL DEFAULT 'digital' CHECK (signature_status IN ('digital', 'on_paper', 'unsigned'))`,
  `UNIQUE (learner_id, lesson_no)` → `INSERT INTO lessons_new (<explicit column list>) SELECT <same list> FROM lessons;` → `DROP TABLE lessons;` → `ALTER TABLE lessons_new RENAME TO lessons;`. Append identical SQL to `SCHEMA_SQL`.

- [ ] **Step 4: Update `Lesson`, `toLesson` (NULL → `null`, never `Number(null)`), `getTotals`, and every compile site** so `npm run typecheck` passes. History rows render missing values as `—`; PDF draws nothing for a NULL cell.

- [ ] **Step 5: Run** `npm run typecheck && npm test` — Expected: all PASS (261 existing + new).

- [ ] **Step 6: Commit** `feat(db): migration 0006 — nullable paper-lesson fields, record_source, signature_status`

### Task 2: History Edit for paper lessons

**Files:**
- Modify: `lib/repo.ts#updateLesson`
- Modify: `lib/types.ts` (`LessonInput.signatureStatus?: unknown`)
- Test: new `tests/paper-lesson-edit.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `updateLesson` accepts, **only when the existing lesson is `paper_import`**: empty times (both or neither), empty odometers (both or neither), `signatureStatus: "on_paper" | "unsigned"` (required for paper lessons), no signature images.

- [ ] **Step 1: Write failing tests** (seed paper lessons with direct SQL inserts in the test, since the importer comes in Task 4)
  - `paper edit: blank times and odometer save as NULL and recompute downstream cumulative treating NULL as 0`
  - `paper edit: one of start/finish time given → ValidationError "Enter both start and finish time, or leave both blank."` (same wording pattern for odometer: `"Enter both start and finish odometer, or leave both blank."`)
  - `paper edit: no signatures required; signatureStatus changes to unsigned`
  - `paper edit: invalid signatureStatus → ValidationError`
  - `paper edit: competency rules unchanged` (e.g. teaching an already-achieved competency still rejected)
  - `paper edit: odometer monotonicity skips NULL neighbours` — #1 finish 100, #2 NULL, #3 start 150; editing #3 start to 90 → rejected citing Lesson #1; to 110 → ok
  - `paper edit with integration enabled: no outbox row for the paper lesson; a downstream App lesson that already has an event gets a propagated event with new cumulative` (use `tests/helpers/fake-actgds-receiver.ts` like `tests/integration-history-edit-propagation.test.ts`)
  - `app edit unchanged: blank times still rejected; signatures still required`

- [ ] **Step 2: Run** `npm test` — Expected: new tests FAIL.

- [ ] **Step 3: Implement** in `updateLesson`: branch on `existing.recordSource`. Paper branch: nullable parsing, `signature_status` from input, keep existing signature columns untouched, skip the signature-redraw rule, `outboxInsert = null`. Both branches: cumulative running sum uses `?? 0`; odometer neighbour checks use the nearest earlier/later lesson with a non-NULL reading. Downstream propagation code stays as-is (paper lessons never have outbox rows, so they are already skipped).

- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: all PASS.

- [ ] **Step 5: Commit** `feat(lessons): History Edit supports paper-imported lessons`

### Task 3: Pure CSV parser and import planner

**Files:**
- Create: `lib/paper-import.ts`
- Test: new `tests/paper-import.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PAPER_CSV_COLUMNS = ["date","start_time","finish_time","start_odometer","finish_odometer","taught","assessed_achieved","assessed_not_achieved","location","comments","signature","instructor"] as const;
  export function parseCsv(text: string): string[][];
  export type PaperImportRowError = { row: number; message: string }; // row = 1-based data row (header excluded)
  export type PlannedPaperLesson = {
    lessonNo: number; lessonDate: string;
    startTime: string | null; finishTime: string | null;
    startOdometer: number | null; finishOdometer: number | null;
    durationMinutes: number | null; distanceKm: number | null;
    cumulativeMinutes: number; cumulativeKm: number;
    taughtIds: string[]; assessedIds: string[]; achievedResults: Record<string, AssessmentResult>;
    location: string | null; comments: string | null;
    signatureStatus: "on_paper" | "unsigned"; instructorId: string;
  };
  export type PaperImportPreview = {
    lessonCount: number; totalMinutes: number; totalKm: number;
    missingDataLessonNos: number[]; unsignedLessonNos: number[];
    progress: LearnerProgress;
  };
  export type PaperImportPlan =
    | { ok: true; lessons: PlannedPaperLesson[]; preview: PaperImportPreview }
    | { ok: false; errors: PaperImportRowError[] };
  export function planPaperImport(csvText: string, instructors: readonly Pick<Instructor, "id" | "fullName" | "status">[]): PaperImportPlan;
  ```

- [ ] **Step 1: Write failing tests**
  - `parseCsv handles quoted fields`: `a,"b, ""c""",中文备注` → `["a", 'b, "c"', "中文备注"]`; embedded newline inside quotes preserved.
  - `parseCsv strips BOM and handles CRLF`: `"﻿date,x\r\n1,2\r\n"` → `[["date","x"],["1","2"]]`; trailing blank lines ignored.
  - `header must match exactly`: missing column → error row 0 `"Missing column: instructor"`; extra column `email` → error row 0 `"Unexpected column: email"`.
  - `empty file / header only` → error `"No lessons found in the file."`
  - `derived values`: 3 rows (09:00–10:00, 0–20 km; blank times + blank odometer; 10:00–10:30, 25–40) → lessonNos 1..3, durations `[60, null, 30]`, distances `[20, null, 15]`, cumulative minutes `[60, 60, 90]`, km `[20, 20, 35]`, `missingDataLessonNos = [2]`.
  - `field errors are reported per row and all collected`: bad date, finish ≤ start, only one time, only one odometer, finish odometer < start, odometer lower than an earlier row's finish (skipping NULL rows), unknown competency id, duplicate id in one cell, date earlier than previous row, signature not `on_paper|unsigned`, instructor not an active instructor (`Tony`, `Anna` match `fullName` exactly, case-sensitive) — each produces `{ row, message }` and the plan is `ok: false`.
  - `competency gates enforced cumulatively`: row 1 assesses `18` achieved before 1–17 + Review 1-17 → error on row 1 with `POST_REVIEW_1_17_LOCK_MESSAGE`; a valid sequence achieving 1–17, then `review-1-17`, then `18` → ok.
  - `rows after completion rejected`: a row after `final-drive-23` achieved → error `"CBT&A is already completed for this learner — no further CBT&A lessons can be recorded."`
  - `taught and assessed overlap rejected` (reuses `validateLessonCompetencies` message).

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `parseCsv` (RFC 4180, no dependency) and `planPaperImport`: validate header, then each row in order; reuse `parseTime`/`durationMinutes`/`distanceKm`/`parseOdometer` from `lib/calc.ts` and `computeProgress`/`validateLessonCompetencies`/`ALL_ASSESSABLE_IDS`/`CORE_COMPETENCY_IDS` from `lib/competency.ts`, accumulating in-memory `CompetencyEvent`s (synthetic `lessonId` per row) exactly as `createLesson` does. Text limits: location 200, comments 3000 (same as `repo.ts#text`). Collect every row error; stop competency checks for a row once its fields are invalid.

- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(import): pure CSV parser and paper-import planner`

### Task 4: Repository import + API route

**Files:**
- Modify: `lib/repo.ts` (new `importPaperLessons`)
- Create: `app/api/learners/[id]/import/route.ts`
- Test: new `tests/paper-import-repo.test.ts`

**Interfaces:**
- Consumes: `planPaperImport`, `PaperImportPreview`, `PaperImportRowError` (Task 3).
- Produces:
  ```ts
  export type PaperImportResult =
    | { mode: "preview"; preview: PaperImportPreview }
    | { mode: "commit"; preview: PaperImportPreview; lessonCount: number }
  export class PaperImportError extends ValidationError { constructor(public errors: PaperImportRowError[]) }
  export async function importPaperLessons(db: D1Database, learnerId: string, csvText: string, mode: "preview" | "commit"): Promise<PaperImportResult>;
  ```
  Route: `POST /api/learners/:id/import`, body `{ csv: string, mode: "preview" | "commit" }` → `200` with `PaperImportResult`; on `PaperImportError` → `400 { error: "Import has errors.", rows: PaperImportRowError[] }` (extend `lib/api.ts#handle` for this subclass); `NotFoundError` → 404. CSV larger than 512 KiB → `ValidationError("File is too large.")`.

- [ ] **Step 1: Write failing tests**
  - `preview writes nothing`: lessons/competency_events counts unchanged.
  - `commit writes lessons 1..N with record_source paper_import, derived values from the plan, competency_events, and zero integration_outbox rows` (integration hooks enabled in the test — still zero rows).
  - `learner with an existing lesson is rejected`: `ValidationError("Paper records can only be imported into a learner with no lessons.")`.
  - `second commit is rejected and writes nothing` (Review Focus 3).
  - `commit fails atomically if a lesson appeared after preview`: create one App lesson between the guard read and the batch (inject via a wrapped `db.batch` in the test, as `tests/integration-alignment.test.ts` does) → batch fails on `UNIQUE (learner_id, lesson_no)`, zero paper lessons written (Review Focus 4).
  - `after import, next App lesson is N+1, its cumulative includes paper totals, and start-odometer prefill is the latest non-NULL finish`.
  - `after import with integration enabled, the next App lesson's event has lesson_number N+1 and cumulative/progress including paper lessons, and validates against lesson-upserted-v1.schema.json` (use `tests/helpers/schema-validate.ts`).
  - `archived learner`: import still allowed (archive is display-only) — assert success.

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement** `importPaperLessons`: `getLearner` (404), `getTotals().lessonCount === 0` guard, `listActiveInstructors`, `planPaperImport`; on `commit` build one `db.batch()` of lesson INSERTs (`record_source = 'paper_import'`, `signature_status` from row, signatures NULL, `instructor_id` from row) + competency_event INSERTs. The lesson_no unique constraint is the race guard. Then the route file mirroring `app/api/learners/[id]/lessons/route.ts`.

- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run build` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(import): atomic paper-lesson import API`

### Task 5: PDF signature status

**Files:**
- Modify: `lib/pdf-export.ts` (`drawLessonRow`, `lessonTotalsText`)
- Test: `tests/pdf-export.test.ts`

**Interfaces:**
- Produces: `lessonTotalsText` returns `""` for a NULL duration/distance; `signatureCellText(lesson: Pick<Lesson,"signatureStatus">): string | null` → `"Paper original"` for `on_paper`, `null` otherwise.

- [ ] **Step 1: Write failing tests**: `lessonTotalsText` NULL → empty strings; `signatureCellText` for each status; `buildCbtaChecklistPdf` with a mixed list (paper lesson with NULLs + `on_paper`, paper `unsigned`, App lesson) succeeds with the expected page count and the cumulative footer text unchanged.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement**: for `on_paper` draw `Paper original` (size 7) in both ADI and Learner signature boxes; `unsigned` draws nothing; `digital` unchanged.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pdf): render paper-imported lessons`

### Task 6: UI — import flow, history badge, paper edit form

**Files:**
- Create: `app/paper-import-panel.tsx` (upload → preview → confirm; owns its own state)
- Modify: `app/driver-app.tsx` (show the panel only when the selected learner has `totals.lessonCount === 0`; `Paper record` badge in History; paper-lesson edit form variant)
- Modify: `app/globals.css` (only classes the new UI needs)
- Modify: `scripts/qa-browser/qa.mjs` (+ `seed.mjs` if a fixture CSV helper is needed; fixture CSV content lives in the script as synthetic data)

**Interfaces:**
- Consumes: Task 4 route and response shapes.

- [ ] **Step 1: Implement `PaperImportPanel({ learnerId, onImported })`**: a button `Import paper records` → `<input type="file" accept=".csv,text/csv">` → reads text → POST `mode: "preview"` → shows lesson count, total hours (`formatMinutes`) / km, achieved count, `Missing data: #…`, `Unsigned: #…`, or the row error list (`Row 7: …`) → `Confirm import` (disabled while submitting) → POST `mode: "commit"` → `onImported()` reloads the learner.
- [ ] **Step 2: History**: `Paper record` badge; `—` for NULL times/odometer/duration/km.
- [ ] **Step 3: Paper edit form**: when editing a `paper_import` lesson, time/odometer inputs are optional (helper text `Leave both blank if not on the paper record`), signature pads replaced by a select `Signed on paper` / `Not signed` (`on_paper` / `unsigned`); App lessons' edit form unchanged.
- [ ] **Step 4: qa-browser checks at 390px (and assert no horizontal scroll at 375px)**: create `QA Paper Learner` → import a synthetic CSV with an error row → error list visible, nothing written → fix → preview numbers → confirm → History shows `Paper record` lessons #1..#N → import button gone → edit a paper lesson with blank times and `Not signed` → save → start a new App lesson: number is N+1, start odometer prefilled → export PDF succeeds.
- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run build && bash scripts/qa-browser/run.sh` — Expected: all PASS.
- [ ] **Step 6: Commit** `feat(ui): paper records import panel and paper lesson editing`

### Task 7: Docs, staging handoff

**Files:**
- Modify: `docs/integrations/actgds-instructor-assistant-v1.md` (short "Paper-imported lessons" note under "No historical backfill in V1": paper lessons never emit events; later App lessons' cumulative/progress include them — no schema change)
- Modify: `STATUS.md`, `TASK.md` (Memory Guard must pass), `README.md` only if it lists migrations

- [ ] **Step 1: Update docs**; `node scripts/check-project-memory.mjs` → `Project Memory Guard: PASS`.
- [ ] **Step 2: Final verification**: `npm run typecheck && npm test && npm run build && bash scripts/qa-browser/run.sh`; `jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum` → `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`.
- [ ] **Step 3: Commit and push** `feature/paper-records-import`; report to Tony and STOP. Merge to `staging`, Staging D1 `0006`, the ACTGDS Issue #3 notice, and every Production step (spec §8) each wait for Tony's explicit authorization.
