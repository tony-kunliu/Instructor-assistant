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
| 1 | ACTGDS Admin authorization fix (`fix/admin-golden-email-escalation`) released to ACTGDS Production | ACTGDS | DONE (ACTGDS v24) |
| 2 | ACTGDS Production `INSTRUCTOR_ASSISTANT_WEBHOOK_SECRET` set | Tony (ACTGDS Sites env) | DONE (re-set by Tony 2026-10-07) |
| 3 | ACTGDS declares Receiver **PRODUCTION READY** | ACTGDS | DONE (actgds.com PR #21) |
| 4 | Same secret value set as Worker secret `ACTGDS_WEBHOOK_SECRET` on `instructor-assistant-production` | Tony (Cloudflare dashboard → Worker → Settings → Variables and Secrets) | DONE 2026-10-07 (match proven only by the first event) |
| 5 | Paper lessons must never emit | Claude | Satisfied by ordering: no paper lesson can exist before P1b ships, and P1b's code never enqueues them — so Release B ships first |
| 6 | Issue #3 notice acknowledged: imported learners' first event may be e.g. `lesson_number: 16` with non-zero cumulative values | ACTGDS | POSTED 2026-10-07, awaiting ACK |

The secret is generated and entered by Tony directly in both dashboards;
it never passes through chat, git, or logs.

## Production window (P1b + Release B)

Production releases run through the GitHub Actions workflow
`.github/workflows/production-release.yml` (manual `workflow_dispatch` on
`main`, input `confirm: production`). It uses the repo secret
`CLOUDFLARE_API_TOKEN` (Workers Scripts Edit + D1 Edit, this account only),
set once by Tony; no token is ever handled in chat or by an agent. The
workflow: typecheck/test/build → records the rollback version and the D1
Time Travel restore point in the run summary → applies pending D1
migrations (`0005`, `0006`) → deploys → checks the Worker answers.

Release B ships before P1b (precondition 5):

1. **Release B**: `ACTGDS_INTEGRATION_ENABLED = "true"` under
   `[env.production.vars]`; merge to `main`; run the workflow (applies
   `0005` only). Verify `lessons` row count
   unchanged and `integration_outbox` exists and is empty.
2. **First event** (coordinated with ACTGDS): one real lesson save produces
   one outbox row; expect `202 pending_link` until Tony links the
   `learner_id` in the ACTGDS CRM, then ACTGDS replays → applied.
3. **P1b** later: rehearse `0006` on Staging D1, merge to `main`, run the
   workflow (applies `0006`). Only then import real paper learners, one at
   a time.

Each step stops on the first failure.

## Rollback

- Integration only: set `ACTGDS_INTEGRATION_ENABLED = "false"` and redeploy
  (outbox rows stay; nothing is deleted).
- Application: `npx wrangler rollback <version-id> --env production` to the
  version recorded in the workflow run summary — safe before the first paper import (see spec §3).
- D1: migrations are not reversed; restore with
  `wrangler d1 time-travel restore instructor-assistant-db-production --bookmark=<bookmark from the run summary>`
  as the last resort (D1 Time Travel keeps 30 days).
