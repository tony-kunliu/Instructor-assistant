# Release B runbook: Integration V1 Production enablement

**Status: NOT AUTHORIZED / NOT STARTED.** This is a checklist, not an
authorization. Every step that touches Production needs Tony's separate,
explicit go-ahead (`AGENTS.md` §3, §5). Stop at the end of each phase and
report.

Release B turns on the `lesson.upserted` Sender in **Production** so the
ACTGDS Website receives lesson data. Scope is exactly: migration `0005`,
webhook URL and secret, enablement flag, deploy. Nothing else.

## Gate 0 - do not start until ALL are true

The Receiver (`tony-kunliu/actgds.com`) must be declared **Receiver
Production READY** by its own `STATUS.md`. As of 2026-10-07 it is not:

- [ ] Admin authorization fix published to the ACTGDS Production Site
      (merged to main, not yet published; Production still v23).
- [ ] `INSTRUCTOR_ASSISTANT_WEBHOOK_SECRET` configured on the ACTGDS
      Production Site (absent as of 2026-10-07).
- [ ] `INSTRUCTOR_ASSISTANT_EXPECTED_ENV=production` still configured there.
- [ ] Configured-secret Receiver negatives and authenticated acceptance
      finished and recorded by the ACTGDS repo.
- [ ] Tony's explicit written go-ahead for Release B in this repo.

If any box is unchecked, stop. Sending to a Receiver without its secret
returns a transient 500, so events would only pile up as pending retries.

## Current Production baseline (verify, do not assume)

From `STATUS.md` (2026-09-30): Worker `instructor-assistant-production`,
version `a8ec37da-9939-48d4-b1d0-fef195b0a09c`, D1 migration level `0004`,
`ACTGDS_INTEGRATION_ENABLED=false`, no webhook URL, no secrets. Rollback
target for the application: `b76eeb2c-163d-4b32-a49d-042d32063e00`.

Re-check before starting: `wrangler deployments list --env production`,
`wrangler secret list --env production`, and the applied migration list.

## Pitfall: always pass `--env production`

`npm run db:migrate:remote` runs `wrangler d1 migrations apply DB --remote`
**without** `--env`, so it targets the top-level (Staging) database, which
is already at `0005`. For Production use the explicit form below. Same for
`wrangler secret put` and deploy. Confirm the target database name in
wrangler's output before approving any prompt:
`instructor-assistant-db-production` is Production;
`instructor-assistant-db` is Staging.

## Phase 1 - Migration `0005` (additive, one table plus two indexes)

- [ ] `wrangler d1 migrations list DB --remote --env production` shows only
      `0005` pending.
- [ ] Take a safety export first:
      `wrangler d1 export DB --remote --env production --output <file>`
      (keep it outside the repo; it contains learner data).
- [ ] `wrangler d1 migrations apply DB --remote --env production`
- [ ] Verify the `integration_outbox` table and its two indexes exist, with
      zero rows, and existing learner/lesson row counts are unchanged.
- [ ] Rollback note: the migration only adds objects (`CREATE ... IF NOT
      EXISTS`). The previous application version ignores them, so rolling
      back the app never needs a DROP.

Report and stop.

## Phase 2 - Secret and webhook URL (still disabled)

- [ ] Secret: `wrangler secret put ACTGDS_WEBHOOK_SECRET --env production`.
      The value must equal the Receiver's
      `INSTRUCTOR_ASSISTANT_WEBHOOK_SECRET`. Enter it only in the prompt;
      never paste it in chat, commits, logs or docs.
- [ ] Add `ACTGDS_WEBHOOK_URL` to `[env.production.vars]` in `wrangler.toml`:
      `https://actgds.com/api/integrations/instructor-assistant/events`
      (not a secret; it is a route). Do not reuse the QA receiver URL that
      the Staging block points at.
- [ ] Keep `ACTGDS_INTEGRATION_ENABLED = "false"` and
      `ACTGDS_INTEGRATION_ENV = "production"` (must match the Receiver's
      expected environment).
- [ ] `wrangler secret list --env production` shows the name only.

## Phase 3 - Deploy and enable

- [ ] Deploy the reviewed `main` source to `instructor-assistant-production`
      with the same method Release A used. This repo does not record the
      exact production deploy command (`npm run cf:deploy` has no `--env`);
      confirm the flag before running, then record it here.
- [ ] Smoke with Integration still off: Access login (Tony + Anna), My
      Learners loads, Sign out works.
- [ ] Flip `ACTGDS_INTEGRATION_ENABLED = "true"` and redeploy.
- [ ] Verify the 5-minute Cron sweep runs without errors
      (`wrangler tail --env production`).

## Phase 4 - Linking and first event (Tony drives this)

- [ ] In Instructor Assistant, copy the learner's Integration ID. In the
      ACTGDS CRM, Tony links it to the real student by hand. Nothing is
      auto-matched.
- [ ] Use ONE real, Tony-approved lesson save as the first valid event. Do
      not use synthetic data in Production.
- [ ] Confirm the outbox row becomes `delivered` and the Receiver shows the
      mirror row (minutes and km agree with the source lesson).
- [ ] No historical backfill: only lessons created or edited after
      enablement produce events (contract, "No historical backfill in V1").

## Kill switch and rollback

- Fastest: set `ACTGDS_INTEGRATION_ENABLED = "false"` and redeploy. Lesson
  saves keep working; the Sender stops.
- Application rollback: redeploy `b76eeb2c-163d-4b32-a49d-042d32063e00` (or
  the then-current known-good version). Leave `integration_outbox` in
  place.
- Never DROP the table, delete outbox rows or replay events without a
  separate authorization.

## After Release B

Update `STATUS.md` (current truth only) and `TASK.md`, record the deployed
Worker version, report, and stop. P3 and later phases are separate tasks.
