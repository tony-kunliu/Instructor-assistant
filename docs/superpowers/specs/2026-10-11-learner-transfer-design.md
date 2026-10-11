# Learner management 3c: transfer a learner to another instructor — design

_Date: 2026-10-11 · Status: **DESIGNED; Q1-Q6 decided: defaults accepted by Tony
2026-10-11** · Implementation (T1, then T2) needs Tony's go per task (no code yet) ·
Based on `origin/staging` 87f328b (D1 at migration `0010`) · Parent plan:
`docs/superpowers/specs/2026-10-08-learner-management-plan.md` (Phase 3)._

## 1. What the code does today (verified)

| Fact | Where |
|---|---|
| A learner has one "home" instructor: `learners.instructor_id`. It drives the "My learners" view (`lib/learner-filter.ts`, a view filter, not authorization), learner-detail edit (owner only, L2: `updateLearner`), the PDF header ADI name and number (`lib/pdf-export.ts` lines 311-312), and the instructor fallback for a lesson saved without a verified identity (`createLesson`). | `lib/repo.ts` |
| `instructorId` is explicitly not editable: `updateLearner` rejects it ("A learner's instructor cannot be changed here."). | `lib/repo.ts#updateLearner` |
| Every lesson already has its own owner: `lessons.instructor_id` = the instructor who recorded it (`actingInstructorId`). **Any active instructor can already record a lesson for any learner**; there is no owner check in `createLesson`. | `lib/repo.ts#createLesson` |
| Only the lesson's own instructor may edit it (E1, CoP 9.1 g / 9.2 d). Others see "Recorded by <name>" instead of Edit. | `updateLesson`, `app/driver-app.tsx` History |
| `lesson.upserted` carries the **lesson's** `instructor_id` and `display_name`, both on create and on edit / downstream propagation (`existing.instructorId`, "never the transient editor"). | `lib/repo.ts`, `lib/integration/contract.ts` |
| Prior-instructor rows (P1b §12) are `lessons` rows with `record_source = 'prior_instructor'`, a free-text `prior_instructor_label` (an external ADI), and `instructor_id` = the home instructor at import time (bookkeeping only; never displayed, never editable, never sent). | `importPaperLessons` |
| Lesson numbers and cumulative totals are per learner (`UNIQUE (learner_id, lesson_no)`), independent of instructor. | `getTotals` |
| Archive / restore: any active instructor; history in `learner_archive_events` (0010). The preset reason `transferred` means "Went to another instructor" (outside this school). | `lib/archive-reasons.ts` |

So a transfer is small in data terms: **only the home instructor changes**. Today
Anna can already teach Tony's learner; what she cannot do is edit the
learner's details, see the learner under "My learners", or get her name on the
PDF header. The workaround (a second learner record) would split the history and
the ACTGDS link, and trigger the duplicate-licence warning.

## 2. Rules from the instruments (DI2020-294, Code of Practice)

| Clause (PDF page of 14) | Text (verbatim, shortened) | Consequence |
|---|---|---|
| 9.1 g (p 10) | "A driving instructor shall not make changes to entries made in records of driving hours by other instructors." | Old lessons stay owned and editable only by the instructor who recorded them, before and after a transfer. |
| 9.2 d (p 10) | Same rule for "a record of competency-based driver assessment". | Same. |
| 9.1 h (p 10) | "must inform the ADI Audit section as soon as possible if he or she has a student from another driving instructor who has a record of driving hours that is not filled out correctly." | Reminder to the receiving instructor (D7). |
| 9.2 e (p 11) | "... a student from another driving instructor who has a record of competency-based driver assessment that is not filled out correctly or is false, misleading or incomplete." | Same reminder; this is R12 in `docs/ACT_ASSESSMENT_STANDARDS.md`. |
| 9 g (p 9), 9.1 f, 9.2 c (p 10) | Offence to record or verify an eligibility requirement where the record "is false, misleading or incomplete". | The transfer must never rewrite who recorded a lesson. |
| 10 f (p 13) | Keep the lesson checklist in the vehicle; "keep records for a minimum period of 12 months". | The previous instructor keeps read access and PDF export (already true: every instructor can open every learner). |

The instruments say nothing about moving a student inside one school, about
who must agree, or about the checklist header after a change of instructor.
Everything below that goes beyond the table is a product decision.

## 3. Decisions

| # | Decision | Recommended default |
|---|---|---|
| D1 | Who initiates | The **current home instructor** hands over: learner panel → "Transfer" → pick the instructor (with two instructors the other one is preselected) → "Transfer to Anna". Two taps, effective immediately, no pending/accept state (Q1). Same principle as L2: only the learner's own instructor manages the learner. |
| D2 | Who may transfer | Only `learners.instructor_id` (verified Access identity). Exception: when the home instructor's `status` is `inactive`, any active instructor may take the learner over (Q2). No verified identity (local dev/tests): allowed, as for learner edit (E3). Target must be an active instructor different from the current one. |
| D3 | What changes | Only `learners.instructor_id` and `learners.updated_at`. **Never touched:** `lessons.instructor_id`, `updated_by_instructor_id`, `lesson_revisions`, `learner_revisions`, `competency_events`, signatures, `learner_archive_events`, prior-instructor rows (incl. their bookkeeping `instructor_id`), outbox rows. |
| D4 | Lesson ownership after transfer | Unchanged (E1). Tony's lessons stay Tony's: Tony can still correct them (his own entries, CoP 9.1 g / 9.2 d), Anna sees "Recorded by Tony" and cannot edit them. New lessons belong to whoever records them. No new rule, no code change in `updateLesson`. |
| D5 | Learner details after transfer | Only the new home instructor may edit (L2 reads `learners.instructor_id`, so this follows automatically). Tony gets the existing "This learner belongs to Anna; only they can edit their details." |
| D6 | How the previous instructor's lessons appear | As today: full lesson rows with "Recorded by Tony", in one continuous numbering. They are **not** converted into prior-instructor rows: P1b prior rows summarise an *external* ADI's paper record, while in-school lessons are complete, signed App records with their own ACTGDS events. History shows one divider line from the transfer events: "Transferred from Tony to Anna, Sun 11 Oct 2026" (Canberra date, AGENTS.md §15) between the last lesson before and the first after. |
| D7 | CoP 9.1 h / 9.2 e check | After a transfer, the receiving instructor sees one amber line on the learner panel: "Check the records from Tony. If any is not filled out correctly, or is false, misleading or incomplete, tell ADI Audit as soon as possible (CoP 9.1 h, 9.2 e)." One tap "Checked" records `records_checked_at/by` on the transfer event and hides it. Reminder only: never blocks lessons or saves. The app never contacts ADI Audit (Q4). |
| D8 | History / audit | New table `learner_transfer_events` (§5), not `learner_revisions`: revisions snapshot the editable detail fields and are read by the edit flow; a transfer is a separate fact (from, to, who, when, check), the same reasoning as 0010's `learner_archive_events`. |
| D9 | ACTGDS | A transfer enqueues **nothing** and the contract is unchanged (hash `c43d2816…b7e6`). `learner_id` stays the same, so the manual CRM link survives. Old lessons keep their events with Tony as instructor; later lessons carry Anna. Because the transfer never changes a lesson's `instructor_id` or `learner_id`, the receiver's `lesson_owner_conflict` (400) cannot be triggered by it. See §6 for the Website mirror. |
| D10 | Archive | An archived learner cannot be transferred: "Restore the learner first." (Q5). Archiving after a transfer works as today. The archive reason "Went to another instructor" stays for learners leaving the school; an in-school move is a transfer, not an archive. |
| D11 | Lesson numbering and totals | Unchanged and continuous (per learner). Paper and prior rows unaffected. |
| D12 | Rules reminders | Unchanged and instructor-independent: R1's 36 h counts from the lesson that completed 1-17 / 1-22, whoever taught it (a Review 1 by Anna at least 36 h after Tony's lesson that completed 1-17). R2, R3, R5 are learner-level. Competency 23 route familiarity (R10 design) uses every earlier lesson, any instructor. |
| D13 | PDF header | Shows the **current** home instructor (as today). When lessons by more than one instructor exist (already possible today), Phase T2 adds one line on the Additional Notes page: "Lessons #1-#8 recorded by Tony (ADI …); #9 onwards by Anna (ADI …)." (Q3). Each row's ADI signature already shows who signed. |
| D14 | Concurrency | Compare-and-set: the UPDATE and the event INSERT both require `instructor_id = <from>` and `archived_at IS NULL`, the event INSERT runs first in the same `db.batch()` (the 0010 pattern). Zero changes → re-read and reply "already transferred to Anna" or "archived". |
| D15 | In-flight work | A lesson Tony is saving when the transfer lands still saves, owned by Tony (no owner check on create, by design). A learner edit by Tony after the transfer is rejected by D5. No data is lost. |
| D16 | Undo | No special undo. The new instructor transfers back (a second event); both stay in history. |
| D17 | Privacy | No learner PII in the event row: ids, timestamps and an optional note (≤ 200 chars, "do not write personal details" as placeholder). Nothing is emailed or sent anywhere. Tests use synthetic `QA …` learners. |

## 4. UX (phone, one or two taps)

- Learner panel action row (owner only, next to Edit / Archive): **Transfer**.
- Sheet: instructor radio list (active instructors except the current one; the
  only choice is preselected), optional note, button "Transfer to Anna".
  Cancel closes. Two taps in the common case.
- After success: toast "Transferred to Anna". Tony's "My learners" no longer
  lists the learner (still in All); Anna's does.
- Receiving instructor: D7 line + "Checked" button (one tap).
- History: D6 divider. The archived banner pattern is reused for a small
  "Transfers" list only if more than one transfer exists (T2).

## 5. Data model — migration `0011` (additive)

```sql
CREATE TABLE IF NOT EXISTS learner_transfer_events (
  id                         TEXT PRIMARY KEY,
  learner_id                 TEXT NOT NULL REFERENCES learners (id),
  from_instructor_id         TEXT NOT NULL REFERENCES instructors (id),
  to_instructor_id           TEXT NOT NULL REFERENCES instructors (id),
  at                         TEXT NOT NULL,            -- UTC ISO
  by_instructor_id           TEXT REFERENCES instructors (id),  -- NULL without identity
  note                       TEXT,                     -- <= 200 chars
  records_checked_at         TEXT,                     -- D7, UTC ISO
  records_checked_by         TEXT REFERENCES instructors (id)
);
CREATE INDEX IF NOT EXISTS learner_transfer_events_learner_idx ON learner_transfer_events (learner_id, at);
```

No ALTER, no backfill, no rebuild. Same SQL appended to `lib/schema.ts`
(`SCHEMA_VERSION = 11`); `tests/d1-storage.test.ts` concatenation check.
Applied to Staging D1 with `Staging D1 Migrate` **before** the code merges to
`staging`; Production via `Production Release` with a recorded restore point.

API: `POST /api/learners/[id]/transfer` `{ toInstructorId, note? }` and
`POST /api/learners/[id]/transfer/checked` (marks the latest unchecked event
whose `to_instructor_id` is the actor). `PATCH /api/learners/[id]` keeps
rejecting `instructorId`. `LEARNER_SELECT` gains two correlated columns from the
latest transfer event (from-name, unchecked flag) so the list and detail stay
one query each.

## 6. ACTGDS Website mirror

- What ACTGDS receives does not change: per-lesson `instructor_id` /
  `display_name` were always the recording instructor, so mixed-instructor
  learners already exist in principle (Anna teaching Tony's learner).
- Not verifiable from this repo: whether the ACTGDS Admin card shows "the
  learner's instructor" and, if so, from which event (latest lesson, first
  lesson). If it uses the latest lesson's instructor, it updates itself at the
  first lesson after a transfer; until then it shows the previous instructor.
  Recommended: one **informational** post on `actgds.com` Issue #3 (standing
  authorization §14.2) describing the behaviour; no change requested (Q6).
- If ACTGDS ever wants the transfer itself (a learner-level "current
  instructor"), that is a new event type = a contract change: **requires
  Tony's separate approval** and an ACTGDS-first schema change. Not proposed.

## 7. D1 budget (Free plan: ≤ 50 queries per invocation, ≤ 100 bound params)

| Call | Statements | Max params per statement |
|---|---|---|
| Transfer | actor lookup 1 + target instructor 1 + learner read 1 + batch of 2 (event INSERT…SELECT, UPDATE) + re-read 1 = **6** | 9 |
| Mark checked | actor 1 + UPDATE 1 + re-read 1 = **3** | 4 |
| Learner list / detail | unchanged count (correlated subselect) | unchanged + 0 |
| Lesson create / edit | unchanged | unchanged |

`tests/d1-query-budget.test.ts` gets both new calls.

## 8. Failure and rollback

- One atomic `db.batch()`: a failure leaves neither the event nor the new owner.
- Concurrent transfer / archive: D14 compare-and-set, clear message, nothing written.
- Code rollback: the migration is additive; the previous Worker ignores the
  table and works with a changed `learners.instructor_id`. Data rollback is a
  reverse transfer (D16), never a DELETE.
- Integration down: irrelevant (nothing enqueued).

## 9. Tests and QA

Unit / integration (`tests/learner-transfer.test.ts`, migration test):
owner transfers; non-owner rejected and nothing written; inactive-owner
exception; target inactive / same / unknown rejected; archived rejected;
compare-and-set race (two transfers, one wins); forced batch failure leaves
nothing; lessons, revisions, competency events, prior rows and outbox
byte-identical before/after; zero outbox rows written; old owner can still edit
own lesson, new owner cannot; learner edit permission moves; R1 across
instructors; numbering continuous; checked flow (only the receiver, idempotent);
schema hash unchanged; migration concatenation; D1 budget.

`qa-browser` at 375px (header-simulated Tony/Anna): Tony transfers in two taps;
learner leaves Tony's "My learners" and appears in Anna's; History divider and
"Recorded by Tony"; Anna's D7 line and "Checked"; Tony's Edit learner disabled;
no horizontal scroll.

Tony's manual smoke test: none beyond one real-login transfer and transfer-back
of a `QA …` learner on Staging (Access identity cannot be simulated).

## 10. Phased delivery

| Task | Content | Migration |
|---|---|---|
| T1 (smallest safe slice) | 0011, transfer endpoint + sheet (D1-D5, D10, D14), History divider (D6), D7 reminder + Checked, tests, qa-browser | 0011 |
| T2 | PDF instructor line (D13), multi-transfer list, Issue #3 info post outcome | none |

Each task ends with a stop and a report (AGENTS.md §11).

## 11. Risks

- Someone transfers the wrong learner: visible toast and History line; fix by transfer-back.
- ACTGDS Admin may show the previous instructor until the next lesson (§6); informational only.
- PDF header shows one ADI for a multi-instructor checklist until T2 (already true today for shared teaching).
- The D7 reminder could become noise if Tony and Anna swap often; it appears once per transfer and is one tap.

## 12. Questions — decided: defaults accepted by Tony 2026-10-11

| # | Question | Decision (default accepted) |
|---|---|---|
| Q1 | Hand over immediately, or must the receiving instructor accept? | Immediate hand-over by the current instructor. |
| Q2 | May anyone take over a learner whose instructor is marked inactive? | Yes, only in that case. |
| Q3 | PDF header after a transfer: current instructor plus a "lessons by instructor" line? | Yes (T2). |
| Q4 | Show the CoP 9.1 h / 9.2 e "check the previous records" reminder for in-school transfers too? | Yes, one tap "Checked". |
| Q5 | Archived learners: restore first, then transfer? | Yes, restore first. |
| Q6 | Post an informational note on Issue #3 so Work knows mixed-instructor learners become common? | Yes, informational only, no contract change. |
