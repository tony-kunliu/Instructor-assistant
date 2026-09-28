# STATUS.md

_Last updated: 2026-09-27_

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
- Tests: 111/111 PASS, 0 skipped.
- Build: PASS.
- `npm test` requires Node's `--experimental-strip-types` flag (already in
  `package.json`'s `test` script) — CI pins Node 22.13, which needs this
  flag explicitly to run `.ts` test files.

## Environments

**Staging**
- Deployed Worker version: `9939629c-7886-4338-9126-a70f8e330b91`
- D1 migration level: `0004` (migration `0005` exists in source, **not**
  applied remotely)
- Cloudflare Access: enabled
- Integration enabled: **NO**

**Production**
- Deployed Worker version: `a5708df9-5dcf-4c10-b26b-212fb4bf9a3f`
- D1 migration level: `0004`
- Cloudflare Access: enabled (Tony + Anna only)
- Integration enabled: **NO**

Neither environment has been redeployed since the Integration Sender source
landed in `staging` — both are still running the pre-Integration build.

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

## Integration V1

- **Contract:** `actgds-instructor-assistant/v1`, event `lesson.upserted`.
- **Canonical schema hash:**
  `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`
  (`jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum`)
- **Cross-repo compatibility:** PASS (ACTGDS/Work final review).
- **Sender source:** IN STAGING (source only — see below).
- **Migration `0005`:** NOT applied to any remote D1.
- **Webhook URL / secret:** NOT CONFIGURED.
- **Integration enabled:** NO, in any environment.
- **Real Staging ↔ ACTGDS QA exchange:** NOT YET TESTED.

"Source in staging" means the code merged and passed CI — it does not mean
deployed, enabled, or connected to anything real. Turning it on for real
needs, in order: a Staging deploy, applying migration `0005` remotely,
`wrangler secret put ACTGDS_WEBHOOK_SECRET`, a real `ACTGDS_WEBHOOK_URL`,
then `ACTGDS_INTEGRATION_ENABLED=true` — none of that has happened.

Full contract detail: `docs/integrations/actgds-instructor-assistant-v1.md`.
Cross-repo coordination record: `tony-kunliu/actgds.com` Issue #3.

## Known Issues

- Real Cloudflare Cron Trigger invocation (outbox retry sweep) is
  dry-run-verified only, not live-fired — needs an actual deploy to confirm.
- A location/comments-only History Edit still emits a propagated event to
  every already-exported downstream lesson even when cumulative
  totals/progress don't change. Correct data, no private content exported —
  non-blocking, possible future optimization.

## Next

Coordinated non-Production Integration QA (Staging ↔ ACTGDS QA), pending
Tony's separate authorization. See `TASK.md` for the immediate next step.
