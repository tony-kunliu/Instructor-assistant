# STATUS.md

_Last updated: 2026-09-29_ (Learner List Usability & Lifecycle MVP)

This file describes **current state only**. Development history lives in
git log and closed PRs, not here — see `TASK.md` for what's in progress.

## Repository

- **main:** `8bae4e4c211a78b2e682d8b04744f102fa1a4328` — trusted baseline
  (rollback reference). Does not yet include GitHub Actions CI or the
  Integration Sender source (not authorized to merge into `main` yet).
- **staging:** contains GitHub Actions CI, the Integration Sender source,
  and the Phase A documentation cleanup. `staging`'s HEAD moves with every
  merge — do not record its exact SHA here as durable state; `git fetch`
  the remote when an exact SHA is needed.

## CI

- Latest `staging` GitHub Actions run: **SUCCESS**.
- Tests: 190/190 PASS, 0 skipped (on the QA-fix branch; CI result recorded by GitHub).
- Build: PASS.
- `npm test` requires Node's `--experimental-strip-types` flag (already in
  `package.json`'s `test` script) — CI pins Node 22.13, which needs this
  flag explicitly to run `.ts` test files.

## Environments

**Staging**
- **Auto-deploy:** Cloudflare Workers Builds (GitHub integration, Tony-
  configured) builds and deploys every `staging` push to Worker
  `instructor-assistant`. No manual `wrangler deploy`; agents have no
  Cloudflare credentials and cannot read build status.
- Deployed Worker version: `358328f4-8d74-4ee8-8985-fc032d7e31bc` (built
  from `6faa89a`, per Tony; has the learner-lifecycle MVP but NOT the QA
  fixes below — those deploy on the next `staging` push).
- D1 migration level: `0005` (applied remotely)
- Cloudflare Access: enabled
- Integration enabled: **YES** (coordinated non-Production QA in progress,
  Tony-authorized; see `tony-kunliu/actgds.com` Issue #3)

**Production**
- Deployed Worker version: `a5708df9-5dcf-4c10-b26b-212fb4bf9a3f`
- D1 migration level: `0004`
- Cloudflare Access: enabled (Tony + Anna only)
- Integration enabled: **NO**

Production has not been redeployed and is still running the
pre-Integration build, unchanged. The Workers Builds "Production branch"
setting is `staging` and drives only the Staging Worker; do not touch
`instructor-assistant-production`.

## Current Product

- Learner + lesson management, CBT&A competencies 1-22, Review 1-17,
  Review 1-22, Final Drive 23, with derived-only duration/km/cumulative
  totals and lesson numbering.
- History Edit: editing an earlier lesson recalculates every downstream
  lesson's cumulative totals and milestone status.
- CBT&A Checklist PDF export (multi-page, official layout).
- Cloudflare Access-gated sign-in, instructor identity resolved from the
  Access JWT.
- Learner "Copy Integration ID" UI for Tony's manual ACTGDS CRM linking.

## Learner List Usability & Lifecycle MVP

- Merged into `staging`; `6faa89a` deployed to Staging (v `358328f4-…`).
  No migration; `archived_at` has existed since `0001`.
- My learners / All / Archived views, name search, Archive / Restore
  (reversible flag, no Integration event, lessons/signatures/PDF/learner
  id untouched). Authorization unchanged: no role model; every
  Access-verified instructor could already open any learner.
- **Real Staging QA (Tony, phone) found 5 issues; fixed on branch
  `fix/learner-lifecycle-qa-findings`** (not yet merged/deployed at the time
  of writing — check `git log origin/staging`):
  1. Competency 18-22 had no Assessed gate → now Assessed only after 1-17 +
     Review 1-17 Achieved (Taught unrestricted); server-authoritative
     (`assessmentLockReason`), UI chips locked from the same function.
  2. Review 1-22 / Final Drive gates were already correct; regression tests
     added for the full sequence.
  3. Completed learners (Final Drive valid): UI shows a "CBT&A Completed"
     card with the archive suggestion instead of Start Lesson, and the
     server rejects new lessons for them. Completion is derived, so a
     History Edit that invalidates it re-opens lesson creation. The
     reported "no suggestion" could NOT be reproduced (API, tests, browser)
     — only the missing Start Lesson removal / server block were real.
  4. Switching My / All / Archived left the old learner selected and
     injected into the dropdown → selection is now cleared unless the
     learner belongs to the target view.
  5. Login defaulted to All: my own code forced All when the device's
     remembered last learner belonged to a colleague → default is now
     always My learners from the verified identity; the picker shows a
     loading state until `/api/me` resolves.
- Verified locally: typecheck, 190/190 tests, build, Memory Guard; real-
  browser QA at 390px, 62/62 PASS (`scripts/qa-browser/run.sh`, local D1,
  header-simulated Tony/Anna, synthetic QA learners, Integration off).
- **NOT yet done:** deploy of the QA fixes and Tony's real-Access smoke
  test. MVP is **not** marked PASS until both are complete.

## Integration V1

- **Contract:** `actgds-instructor-assistant/v1`, event `lesson.upserted`.
- **Canonical schema hash:**
  `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`
  (`jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum`)
- **Cross-repo compatibility:** PASS (ACTGDS/Work final review).
- **Sender source:** DEPLOYED to Staging (see below).
- **Migration `0005`:** applied to Staging D1 (remote). NOT applied to
  Production.
- **Webhook URL / secret:** CONFIGURED on Staging only —
  `ACTGDS_WEBHOOK_URL` set to the ACTGDS QA Receiver endpoint;
  `ACTGDS_WEBHOOK_SECRET` binding confirmed present by name (value never
  read by this repo's agents). Production has neither configured.
- **Integration enabled:** YES on Staging only; NO on Production.
- **Real Staging ↔ ACTGDS QA exchange:** NOT YET TESTED end-to-end for
  duplicate/stale cases (create + update both delivered and mapped;
  duplicate/stale verification moved to ACTGDS Receiver's own isolated
  protocol QA mechanism, not Sender-side). Sequence so far, same synthetic
  learner (`05e8f7f4-0a8c-40b8-8117-0fd32e91b2ae`) and lesson
  (`43180a4d-a6f4-4121-b8a8-036343544346`), both created/edited by Tony via
  his own real Access session:
  1. Create — `event_id 330cf15f-2c6c-499a-adbc-83654353cbc5`, delivered
     first attempt; ACTGDS mapped the learner to a QA student and replayed
     it (applied).
  2. Update (History Edit) — `event_id b74bc541-9dd5-4262-a4a1-b293f1d9c22e`,
     `source_updated_at` `2026-09-28T16:51:49.977Z` (strictly newer than
     the create event), delivered first attempt, Staging outbox
     `delivered`/`attempt_count 0`/no error. Updated snapshot per this
     event's own payload: `duration_minutes` 64 (was 1), `distance_km` 20
     (was 4), `finish_time` 23:26 (was 22:23) — Receiver mirror equality
     not yet independently confirmed.
  Sender attempted a direct Staging `integration_outbox` row reset for a
  duplicate-delivery test; that write was denied by an automated safety
  classifier before any mutation occurred, and Tony instructed not to
  retry or request that permission — duplicate/stale is now Receiver's
  own protocol QA to run (Receiver confirmed this via its own isolated
  protocol test harness, not a live hosted redelivery).
  3. Retry / real hosted Cron recovery (Tony-approved design) — a further
     edit produced `event_id 31a3d3d0-09ec-43ef-b303-bd78856e0713`.
     Staging's `ACTGDS_WEBHOOK_URL` was deliberately, temporarily pointed
     at a reserved `.invalid` host, inducing a real retryable failure
     (HTTP 530, outbox `pending`/`attempt_count 1`/`last_error_code
     http_530`), then restored to the real QA URL. With zero manual
     retry/replay/outbox mutation afterward, the real hosted Cloudflare
     Cron Trigger (directly observed via `wrangler tail`: a `scheduled`
     invocation at `2026-09-28T17:20:08Z`) picked up the due row and
     delivered it successfully — outbox flipped to `delivered`,
     `delivered_at 2026-09-28T17:20:08.746Z` (matching the observed Cron
     firing and `>= next_attempt_at`). Confirms real automatic
     retry+recovery, not simulated. See `tony-kunliu/actgds.com` Issue #3
     for the full evidence trail and next handshake.

Staging is now fully configured for this coordinated QA round. Production
remains completely untouched: migration `0004`, Integration disabled, no
webhook configured, no redeploy.

Full contract detail: `docs/integrations/actgds-instructor-assistant-v1.md`.
Cross-repo coordination record: `tony-kunliu/actgds.com` Issue #3.

## Known Issues

- A location/comments-only History Edit still emits a propagated event to
  every already-exported downstream lesson even when cumulative
  totals/progress don't change. Correct data, no private content exported —
  non-blocking, possible future optimization.
- Existing data created under the old rules can hold 18-22 assessed before
  Review 1-17 (e.g. Tony's earlier Staging test learners). It is not
  rewritten; but a History Edit of a lesson that assessed 1-17 and 18-22
  together will now be rejected until corrected. Also, the gate is checked
  against the learner's other lessons regardless of lesson order (same as
  the existing review gates).
- An archived learner is hidden from lesson start in the UI only; the
  lesson-create API itself does not reject archived learners (by design for
  this MVP — archive is a visibility state, not a lock).

## Next

Confirm the Workers Builds deploy of the QA fixes, then Tony's minimal
real-Access smoke test. See `TASK.md`.
