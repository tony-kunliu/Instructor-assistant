# Release B — Production Integration Enablement Runbook

Release B turns on ACTGDS Integration V1 (`lesson.upserted`) for the
**Production** Worker `instructor-assistant-production`. It ships in the
same Production window as P1b (paper records import, migration `0006`) —
see `docs/superpowers/specs/2026-10-07-paper-records-import-design.md` §8.
No contract change: `contract_version` 1, schema hash
`c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`.

## Preconditions (all must hold before step 5)

| # | Precondition | Owner | State 2026-10-07 |
|---|---|---|---|
| 1 | ACTGDS Admin authorization fix (`fix/admin-golden-email-escalation`) released to ACTGDS Production | ACTGDS | NOT DONE |
| 2 | ACTGDS Production `INSTRUCTOR_ASSISTANT_WEBHOOK_SECRET` set | Tony (ACTGDS Sites env) | ABSENT |
| 3 | ACTGDS declares Receiver **PRODUCTION READY** on Issue #3 | ACTGDS | NOT YET |
| 4 | Same secret value set as Worker secret `ACTGDS_WEBHOOK_SECRET` on `instructor-assistant-production` | Tony (Cloudflare dashboard → Worker → Settings → Variables and Secrets) | NOT SET |
| 5 | P1b deployed to Production with Integration still disabled (paper lessons must never emit) | Claude | PENDING P1b |
| 6 | Issue #3 notice acknowledged: imported learners' first event may be e.g. `lesson_number: 16` with non-zero cumulative values | ACTGDS | NOT POSTED |

The secret is generated and entered by Tony directly in both dashboards;
it never passes through chat, git, or logs.

## Production window (P1b + Release B)

1. **Backup** Production D1: `npx wrangler d1 export instructor-assistant-db-production --remote --output <scratchpad>/prod-backup-<date>.sql` (never committed). Record the current Worker version as rollback target (`npx wrangler deployments list --env production`).
2. **Migrate** Production D1: `npx wrangler d1 migrations apply DB --env production --remote` (applies `0005`, `0006`). Verify `lessons` row count unchanged and `SELECT COUNT(*) FROM integration_outbox` = 0.
3. **Deploy** P1b with `ACTGDS_INTEGRATION_ENABLED = "false"`: `npm run cf:build && npx wrangler deploy --env production`. Verify app loads behind Access.
4. Wait for preconditions 1–4 and 6.
5. **Enable**: set `ACTGDS_INTEGRATION_ENABLED = "true"` under `[env.production.vars]`, merge, deploy as in step 3. `ACTGDS_WEBHOOK_URL` is already configured (`https://actgds.com/api/integrations/instructor-assistant/events`).
6. **First event** (coordinated with ACTGDS): one real lesson save produces one outbox row; expect `202 pending_link` until Tony links the `learner_id` in the ACTGDS CRM, then ACTGDS replays → applied. Check `integration_outbox` status and ACTGDS mirror.
7. Only then import real paper learners, one at a time.

Each step stops on the first failure. Step 1 needs a temporary Cloudflare
token with **D1 Edit** + **Workers Scripts Edit** for this account; Tony
revokes it afterwards.

## Rollback

- Integration only: set `ACTGDS_INTEGRATION_ENABLED = "false"` and redeploy
  (outbox rows stay; nothing is deleted).
- Application: `npx wrangler rollback <version-id> --env production` to the
  recorded target — safe before the first paper import (see spec §3).
- D1: migrations are not reversed; the backup from step 1 is the last resort.
