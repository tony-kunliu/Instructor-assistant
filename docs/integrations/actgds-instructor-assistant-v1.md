# Integration Contract: `actgds-instructor-assistant/v1`

**Direction:** Instructor Assistant (sender) → ACTGDS Website (receiver).
**Contract version:** `1`.
**Event type:** `lesson.upserted`.
**Schema:** `docs/integrations/lesson-upserted-v1.schema.json`
**Canonical schema hash (`contract_schema_sha256`):**
`6335f5897731d75799fad59dfff2556eb188abaa2b47c13cdd847a994351ad7e`
(computed as `jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum`
— both repos must produce this exact hash from their copy of the schema
file, or they cannot safely interoperate; recompute and compare on any
schema change).

This document is the human-readable companion to the JSON Schema. See
`AGENTS.md` §10 for the permanent ecosystem boundary rules this contract
operates under (no shared DB, no auto-matching by name/phone/email, etc.).

## Why `lesson.upserted`, not separate create/edit events

A lesson can be edited later (CBT&A V3 History Edit). Rather than model
create and edit as different event types, both produce the same
`lesson.upserted` event type:

- **Create** → `lesson.upserted` (new `lesson_id`, new `event_id`).
- **Edit** → `lesson.upserted` (same `lesson_id`, new `event_id`, newer
  `source_updated_at`).

The receiver upserts by `(lesson_id, source_updated_at)` — never by arrival
order, and never by `lesson_number` (a lesson's number reflects creation
order for display, not version recency).

## Transport

- **Method:** `POST` to `ACTGDS_WEBHOOK_URL`.
- **Headers:**
  - `Content-Type: application/json`
  - `X-IA-Event-ID: <event_id>`
  - `X-IA-Timestamp: <unix-seconds>`
  - `X-IA-Signature: v1=<hex-hmac-sha256>`
- **Signing:** HMAC-SHA256 over the exact bytes `"<timestamp>." + <raw
  request body>`, keyed with `ACTGDS_WEBHOOK_SECRET`. The signature is
  computed over the body's exact serialized bytes — the body is never
  re-serialized after signing, so the receiver must verify against the raw
  bytes it received, not a re-encoded copy.
- **Response handling:**
  - `200`/`202` → delivered, no further retry.
  - A `202` with a `pending_link` status in the response body means ACTGDS
    has durably accepted the event even though the learner isn't linked to
    a student yet — this still counts as delivered, not retried.
  - Network error, timeout, `429`, or `5xx` → retryable.
  - `400`, `401`, `403`, or an unsupported `contract_version` → permanent
    failure, never retried indefinitely.

## Retry schedule

Best-effort immediate delivery attempt at enqueue time (via `waitUntil` when
safely available in the current execution context), backed by a durable
outbox so delivery survives a Worker restart or ACTGDS being down. Retry
backoff on a retryable failure: immediate, 1 min, 5 min, 30 min, 2 hr, 12
hr, then `permanent_failure`.

## Data minimization

This event **never** includes: learner name, phone, email, address, date of
birth, licence number/expiry, eligibility, signatures (or signature
images), comments, private notes, PDF content, raw GPS/route data, or the
raw competency event history. It carries only a teaching summary (this
lesson's numbers) and a progress snapshot (where the learner's CBT&A stands
overall) — exactly the two top-level objects `lesson` and `progress` in the
schema, plus the minimal identity references needed to route it
(`learner_id`, `instructor_id`, `display_name`).

## Learner identity mapping

`learner_id` is Instructor Assistant's own stable id for the learner —
never a name, phone, or email, and never auto-matched to an ACTGDS student
record. The ACTGDS Website is the **sole authority** for linking
`learner_id` to a real student/customer identity; that link is made once,
by hand, by Tony in the ACTGDS CRM. Instructor Assistant does not store an
`actgds_student_id` or any reverse mapping — this avoids mapping drift
between two independently-evolving identity spaces. The Instructor
Assistant UI shows each learner's `learner_id` with a "Copy ID" button
specifically so Tony can paste it into the ACTGDS side during that one-time
linking step.

## Competency id tokens

- Core competencies: the strings `"1"` through `"22"`.
- Special assessments: `"review_1_17"`, `"review_1_22"`, `"final_drive_23"`
  (underscore form in the wire contract — Instructor Assistant's own
  internal ids, `review-1-17` / `review-1-22` / `final-drive-23`, use
  hyphens; the sender adapter converts between the two, the internal form
  never leaks onto the wire).
- `lesson.taught` may only contain core competency tokens (1-22).
- `lesson.assessed` / `lesson.achieved` may contain core competency tokens
  plus the three special assessment tokens.
- `progress.review_1_17` / `review_1_22` / `final_drive_23` are one of
  `locked` / `ready` / `achieved` (see `lib/competency.ts#computeProgress`
  for the authoritative state machine these mirror).
- `progress.cbta_status` is `active` until Final Drive 23 is genuinely
  achieved (see `LearnerProgress.completed`), then `completed`.

## No historical backfill in V1

Only lessons created or edited **after** `ACTGDS_INTEGRATION_ENABLED` is
turned on for an environment produce events. Existing historical lessons
are not backfilled by this contract version — that would be a separate,
deliberate task.

## Versioning

Any breaking change to this contract bumps `contract_version` and is
released in lockstep across both repos — a receiver must reject an
unsupported `contract_version` with a `4xx` (permanent failure on the
sender side), never silently attempt to interpret an unknown shape.
