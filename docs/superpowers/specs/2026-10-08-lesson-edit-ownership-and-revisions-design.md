# Lesson edit ownership + revision history — Design

_Date: 2026-10-08 · Status: APPROVED by Tony (2026-10-08) · Scheduled after
P1b · Source rule: ACT Driving Instructor Code of Practice 2020 (DI2020-294)
9.1 g and 9.2 c–d — see `docs/ACT_ASSESSMENT_STANDARDS.md` R6._

## Rule

A driving instructor corrects an error by striking out the incorrect
information and initialling the correction. They must not change entries
made by other instructors.

## Decisions

| # | Decision |
|---|---|
| E1 | Only the lesson's own instructor (`lessons.instructor_id`) may edit it. Paper-imported lessons belong to the instructor named in their CSV row. Prior-instructor records are never editable. |
| E2 | Any other instructor gets a validation error: "This lesson was recorded by <name>; only they can change it (Code of Practice 9.2)". The UI hides Edit on lessons the signed-in instructor does not own. |
| E3 | When there is no verified Access identity (local dev or tests without `actingInstructorId`), today's behaviour is kept. Production always has an identity, so E1 always applies there. |
| E4 | Every successful edit first stores a **revision**: a snapshot of the lesson's previous content, who edited and when, and an optional reason. It is written in the same atomic `db.batch()` as the edit. |
| E5 | History shows "Edited N times". Opening it lists each previous version, with changed values struck through (the digital "strike out and initial"). |
| E6 | The PDF marks amended lessons with "(amended)" next to the lesson number. |
| E7 | The edit form has an optional free-text reason field (max 200 chars). |
| E8 | ACTGDS integration is unchanged: no new fields, no contract change. |

## Data model — migration `0007`

New table `lesson_revisions`. Additive only; no existing data changes.

| Column | Contents |
|---|---|
| `id` | primary key |
| `lesson_id` | FK to the lesson |
| `revision_no` | revision sequence number |
| `edited_at` | when the edit was made |
| `edited_by_instructor_id` | who made the edit |
| `reason` | optional reason (E7) |
| `snapshot_json` | the previous values of every editable field plus `signature_status`; signature images are excluded, only whether each signature was present |

## Testing

**Unit tests**
- The owner can edit their own lesson.
- A non-owner is rejected and nothing is written.
- The revision is written atomically with the edit; a forced batch failure leaves neither.
- The snapshot holds the previous values.
- Prior-instructor rows are rejected.
- The D1 query budget still holds.

**qa-browser**
- Anna cannot edit Tony's lesson.
- Tony edits his own lesson and sees "Edited 1 time" with the struck-through old value.
- The PDF shows "(amended)".
