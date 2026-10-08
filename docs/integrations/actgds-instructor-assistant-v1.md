# Integration Contract: `actgds-instructor-assistant/v1`

**Direction:** Instructor Assistant (sender, this repo) → ACTGDS Website
(receiver, `tony-kunliu/actgds.com`).
**Contract version:** `1`.
**Event type:** `lesson.upserted`.
**Schema:** `docs/integrations/lesson-upserted-v1.schema.json` — a
byte-identical copy of ACTGDS's own canonical file. **ACTGDS is the
canonical authority for this contract; this repo copies it, never
redefines it.** On any future contract change, ACTGDS's copy changes
first and this repo copies it again — never the other way around.
**contract_schema_sha256:**
`c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`
(`jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum`
— both repos must produce this exact hash, or they cannot safely
interoperate; recompute and compare on any schema change). Confirmed
against ACTGDS's receiver handoff in
[Issue #3](https://github.com/tony-kunliu/actgds.com/issues/3)
("CONTRACT READY FOR CLAUDE", receiver commit `d0559bec3393bfacaa8e8881e2f9abfa1dbd4978`).
**Shared fixtures:** `docs/integrations/lesson-upserted-v1.fixtures.json`
— also copied byte-for-byte from ACTGDS; `tests/integration-alignment.test.ts`
validates every one of its valid cases against this repo's own schema copy
and payload builder.

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
order for display, not version recency). `source_updated_at` is normalized
UTC ISO-8601; equal timestamps are a no-op, older ones are ignored.

## Transport and authentication

`POST /api/integrations/instructor-assistant/events` on the ACTGDS Worker,
`Content-Type: application/json`. Maximum body size **32 KiB** — every
real payload this sender produces is a small fraction of that. This
endpoint uses neither Golden nor ChatGPT sessions; it authenticates purely
via the HMAC signature below.

Headers:

- `X-IA-Event-ID`: exact payload `event_id`.
- `X-IA-Timestamp`: ten-digit Unix seconds, must be fresh within ±300
  seconds of the receiver's clock at delivery time — a retry always uses a
  **fresh** timestamp (and therefore a fresh signature), never the
  original delivery's.
- `X-IA-Signature`: `v1=<64 lowercase hex characters>`.

**Signing:** HMAC-SHA256 over the exact bytes `"<timestamp>." + <raw
request body>`, keyed with `ACTGDS_WEBHOOK_SECRET`. The signature covers
the body's exact serialized bytes — **the body is never re-serialized
after signing, on the first delivery or any retry.** Concretely: the
sender's outbox (`migrations/0005_integration_outbox.sql`) stores the
`JSON.stringify`-produced string exactly once, at enqueue time
(`lib/integration/outbox.ts#insertOutboxRowStatement`); every delivery
attempt, immediate or retried, sends that same stored string verbatim
(`lib/integration/sender.ts#attemptWebhookDelivery` takes the raw body
string directly — it never accepts a payload object to re-stringify). This
is what makes `event_id` a safe idempotency key: the receiver hashes the
raw bytes it receives (`payload_hash`) and treats a mismatch under the same
`event_id` as `409 event_id_conflict` — a **permanent** sender error, since
by construction the same `event_id` must always carry the same bytes.

## Responses

| HTTP | status | Meaning | Sender outcome |
| --- | --- | --- | --- |
| 200 | applied | Snapshot durably applied | delivered |
| 200 | duplicate | Same event_id + same payload_hash; not re-applied | delivered |
| 200 | stale_ignored | Equal/older snapshot; no mirror change | delivered |
| 202 | pending_link | Durably accepted, learner not yet linked to a student | delivered — **stop retrying** |
| 400 | invalid_schema | Invalid schema/body (or `lesson_owner_conflict`) | permanent |
| 401 | invalid_signature | Invalid/stale signature, or `event_id_mismatch` | permanent |
| 403 | environment_not_allowed | Signed `source.environment` doesn't match the receiver's configured environment | permanent |
| 409 | event_id_conflict | Same `event_id`, different `payload_hash` (`event_id_payload_mismatch`) | **permanent** — investigate event construction, never retry |
| 415 | invalid_content_type | Body isn't `application/json` | permanent |
| 500 | transient_internal_error | Receiver-side transient failure | retryable |
| network error / timeout / 429 / other 5xx | — | — | retryable |

`lib/integration/sender.ts#classifyDeliveryOutcome` implements exactly this
table (200/202 → delivered; 429/5xx/network → retryable; every other 4xx,
409 included → permanent).

## Retry schedule

Best-effort immediate delivery attempt right after the enqueueing lesson
save/edit commits (via the caller-supplied `IntegrationHooks.schedule` —
`ExecutionContext.waitUntil` in the real deployed Worker, so a slow/
unreachable webhook can't hold up or crash the request). Durability itself
comes from the outbox, not the immediate attempt. On a retryable failure,
backoff sets `next_attempt_at` to immediate → 1 min → 5 min → 30 min → 2 hr
→ 12 hr, then `permanent_failure` (6 attempts total) — **these are minimum
retry eligibility offsets, not exact execution deadlines.** A row only
actually gets retried at the next Cron sweep at or after its
`next_attempt_at`, and the sweep itself runs every 5 minutes
(`worker/scheduled-entry.ts`'s Cloudflare Cron Trigger — see STATUS.md for
what's verified about this and what isn't). A "+1 min" eligibility can
therefore land anywhere up to roughly +6 min in practice (the 1-minute
offset plus up to another ~5 minutes waiting for the next sweep), and
runtime delays can add a little more — never earlier than eligibility,
routinely somewhat later. The same `processDueOutbox` function runs the
sweep, so a retry scheduled for later doesn't
sit waiting for an unrelated future lesson save to (accidentally) trigger
it again.

## Data minimization

This event **never** includes: learner name, phone, email, address, date of
birth, licence number/expiry, eligibility, signatures (or signature
images), comments, private notes, PDF content, raw GPS/route data, or the
raw competency event history. It carries only a teaching summary (this
lesson's numbers) and a progress snapshot (where the learner's CBT&A stands
overall) — exactly the two top-level objects `lesson` and `progress` in the
schema, plus the minimal identity references needed to route it
(`learner_id`, `instructor_id`, `display_name`). Every object in the schema
sets `additionalProperties: false`, so an accidental extra field fails
validation, not just review.

## Learner identity mapping

`learner_id` is Instructor Assistant's own stable id for the learner —
never a name, phone, or email, and never auto-matched to an ACTGDS student
record. The ACTGDS Website is the **sole authority** for linking
`learner_id` to a real student/customer identity; that link is made once,
by hand, by Tony in the ACTGDS CRM. Instructor Assistant does not store an
`actgds_student_id` or any reverse mapping — this avoids mapping drift
between two independently-evolving identity spaces. The Instructor
Assistant UI shows each learner's `learner_id` ("Integration ID") with a
"Copy ID" button specifically so Tony can paste it into the ACTGDS side
during that one-time linking step.

## Competency id tokens

- Core competencies: the strings `"1"` through `"22"`.
- Special assessments: `"review_1_17"`, `"review_1_22"`, `"final_drive_23"`
  (underscore form in the wire contract — Instructor Assistant's own
  internal ids, `review-1-17` / `review-1-22` / `final-drive-23`, use
  hyphens; `lib/integration/contract.ts#toWireCompetencyId` converts
  between the two — the internal form never reaches the wire).
- `lesson.taught` may only contain core competency tokens (1-22), max 22
  items. Special assessments are **never** taught — the schema's own
  pattern rejects a special token in `taught` outright (fixture H).
- `lesson.assessed` / `lesson.achieved` may contain core competency tokens
  plus the three special assessment tokens, max 25 items each.
- Cross-array semantics the JSON Schema itself can't express, enforced at
  the receiver as runtime validation (fixtures F/G) — and already
  structurally guaranteed on this sender's side by
  `lib/competency.ts#validateLessonCompetencies`, which is called before
  any lesson (and therefore any event) is ever created or edited:
  `achieved` must be a subset of `assessed`; `taught` and `assessed` must
  be disjoint (a competency already achieved, or being assessed this
  lesson, is never also marked taught).
- `progress.review_1_17` / `review_1_22` / `final_drive_23` are one of
  `locked` / `ready` / `achieved` (see `lib/competency.ts#computeProgress`
  for the authoritative state machine these mirror).
- `progress.cbta_status` is `active` until Final Drive 23 is genuinely
  achieved (see `LearnerProgress.completed`), then `completed`.

## Durable outbox and atomicity

A lesson save/edit's own D1 write is never blocked, slowed, or failed by
the integration (`AGENTS.md` §10). The outbox row for a `lesson.upserted`
event is enqueued in the **same `db.batch()` call** as the lesson row and
its `competency_events` — see `lib/repo.ts#createLesson`/`#updateLesson`
and `#prepareIntegrationOutboxInsert`. This is a single atomic D1
transaction: the lesson, its competency events, and its integration event
all commit together or none of them do. There is no window where a lesson
exists in the database with no corresponding integration event — the gap
an earlier round of this feature left open and explicitly documented as a
trade-off is closed as of this round (`tests/integration-alignment.test.ts`
tests I and J verify this directly: exactly one `db.batch()` call per
lesson save, and a forced batch failure loses the lesson and its event
together, never one without the other).

## Per-lesson source_updated_at monotonicity

For any given `lesson_id`, every `lesson.upserted` event this sender ever
produces — its original create, a direct edit, or a downstream propagation
from editing an earlier lesson (see above) — must carry a
`source_updated_at` strictly greater than every prior event already
recorded for that same `lesson_id`, regardless of which of those paths
produced the prior one. The receiver's own upsert rule (equal or older
version is a no-op, `stale_ignored`, still `HTTP 200`) means a same-or-older
version is not just wasted — it is silently accepted as "delivered" while
the receiver's mirror never actually changes, and no outbox row is left
pending for any retry to repair. `lib/integration/outbox.ts#ensureStrictlyNewerSourceUpdatedAt`
is the single mechanism enforcing this, checked in both `createLesson` (no
prior version exists yet) and `updateLesson` — the direct edit's own event
and every downstream propagated event each look up the latest version
already recorded for *their own* `lesson_id` specifically (never a
different lesson's), so a lesson that was itself a downstream propagation
target in an earlier edit still gets a strictly newer version when it is
later edited directly.

## No historical backfill in V1

Only lessons created or edited **after** `ACTGDS_INTEGRATION_ENABLED` is
turned on for an environment produce events. Existing historical lessons
are not backfilled by this contract version — that would be a separate,
deliberate task.

### Paper-imported lessons

Lessons imported from a paper logbook (`record_source = 'paper_import'`) and a
transfer learner's prior-instructor records (`'prior_instructor'`) never
emit `lesson.upserted` events and never create `integration_outbox` rows.
Later App lessons' cumulative values and progress include them. There is
no contract or schema change; `contract_version` stays `1`.

## Versioning

Any breaking change to this contract bumps `contract_version` and is
released in lockstep across both repos — a receiver must reject an
unsupported `contract_version` with a `4xx` (permanent failure on the
sender side), never silently attempt to interpret an unknown shape. Every
contract decision is recorded in
[Issue #3](https://github.com/tony-kunliu/actgds.com/issues/3) using the
FROM/REPO/BRANCH/COMMIT/CONTRACT VERSION/CONTRACT SHA256/STATUS/CHANGED/
NEEDS OTHER SIDE/BLOCKERS/NEXT HANDSHAKE format ACTGDS established. An ACK
there is evidence of alignment, not authorization to merge, configure
secrets, or deploy.
