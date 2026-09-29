# STATUS.md

_Last updated: 2026-09-29_ (Learner Lifecycle / CBT&A Staging round — PASS)

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
- Tests: 252/252 PASS, 0 skipped.
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
- Last Worker version reported by Tony: `358328f4-8d74-4ee8-8985-fc032d7e31bc`
  (built from `6faa89a`). Later `staging` commits deploy automatically; the
  agent has no way to read Cloudflare / Workers Builds status, and Staging
  is behind Access, so "which commit is live" is **not agent-observable
  today** (see Known Issues for the smallest fix).
- D1 migration level: `0005` (applied remotely)
- Cloudflare Access: enabled
- Integration enabled: **YES** (non-Production only; coordinated QA
  **PASS**, see Integration V1 below)

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

## Learner List Usability & Lifecycle MVP — PASS

- My learners / All / Archived views, name search, Archive / Restore
  (reversible flag, no Integration event, lessons/signatures/PDF/learner
  id untouched). No migration. Authorization unchanged: no role model;
  every Access-verified instructor could already open any learner.
- Tony's real-Staging findings (18-22 gate, completed learners, view
  switching, login default) were fixed and verified by Tony. The
  real-account / real-phone smoke tests (Access login → My learners;
  signature drawn on a real phone and a lesson saved) **PASSED** — manual
  acceptance is complete.
- **CBT&A chronology (History Edit).** A lesson may only Assess a gated
  item if its prerequisites were Achieved in EARLIER lessons (lesson number
  = creation order, never editable); a later lesson can never legitimise an
  earlier one:
  Review 1-17 needs 1-17; Competency 18-22 needs 1-17 + Review 1-17;
  Review 1-22 needs 1-17 + Review 1-17 + 18-22; Final Drive 23 needs
  Review 1-22 (and its chain). The same lesson never counts. Taught is
  unrestricted except "already achieved in an EARLIER lesson" (achieved
  later is normal — this also fixes editing an early lesson that taught a
  competency achieved afterwards, which used to be rejected).
  Enforced server-side (`assessmentChronologyViolations`,
  `assessmentLockReason`); the edit form's chips use the earlier-lessons
  progress. Legacy violations are tolerated and never rewritten (only NEW
  ones block an edit). Effects on LATER lessons: an Assessed 18-22 there has
  no rollback, so an edit that breaks its prerequisites is rejected
  ("Correct Lesson #N first"); later Review / Final Drive milestones keep
  the existing derived rollback and are reported via `invalidated`.
- Save failure UX: error summary above Save with per-problem "Go to …"
  jump links (new lesson and History Edit), kept until fixed.
- Working rule: `AGENTS.md` §13 (agent owns automatable QA and deployment
  verification; Tony/Anna only real-login / real-phone smoke checks).
- Verified: typecheck, 252/252 tests, build, Memory Guard, GitHub CI;
  real-browser QA at 390px 91/91 PASS (`bash scripts/qa-browser/run.sh`:
  local D1, header-simulated Tony/Anna, synthetic QA learners, Integration
  off).

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
- **Coordinated non-Production Integration V1 QA: PASS.** Final Receiver
  adjudication in `tony-kunliu/actgds.com` Issue #3 (comment 5880411046):
  "FINAL COORDINATED NON-PRODUCTION INTEGRATION V1 QA: PASS; outstanding
  Integration V1 blockers: NONE". Tested scope, all on the same synthetic
  learner / lesson, driven through Tony's real Access session:
  1. Create — first real signed delivery, accepted as `pending_link`, then
     explicit learner↔student mapping and replay → applied.
  2. Real History Edit update — newer `source_updated_at` upserted the same
     mirror row.
  3. Retryable failure + real hosted Cloudflare Cron recovery — temporary
     Staging-only `.invalid` webhook URL gave a real HTTP 530 and a durable
     pending outbox row; after the URL was restored, the hosted Cron
     delivered the same immutable row with no manual retry, and the
     Receiver applied it (final values 83 min / 30 km).
  4. Duplicate / stale / event-id immutability — verified by the Receiver's
     isolated protocol tests (PASS).
  5. Privacy minimization and CRM independence — PASS.
  The earlier 64/20 vs 83/30 discrepancy was a Sender *reporting* error (an
  unverified value copied into a handoff), not a code or data defect; source
  lesson, outbox payload and Receiver mirror all agree at 83/30, and no
  corrective resend is needed.
- **Known non-blocking limitations:** duplicate/stale were isolated
  Receiver protocol tests, not hosted duplicate/stale deliveries;
  historical backfill is intentionally not part of V1; the literal
  historical Receiver HTTP response was not retained; the hosted Cron
  invocation is evidenced by the Sender's own tail, corroborated by the
  Receiver's arrival time.
- **Production rollout is NOT authorized.** It needs Tony's separate,
  explicit authorization (migration `0005`, webhook URL/secret, enablement
  and deploy are all still to be done for Production). Production remains
  unchanged: migration `0004`, Integration disabled, no webhook configured,
  no redeploy.

Full contract detail: `docs/integrations/actgds-instructor-assistant-v1.md`.
Cross-repo coordination record: `tony-kunliu/actgds.com` Issue #3.

## Known Issues

- A location/comments-only History Edit still emits a propagated event to
  every already-exported downstream lesson even when cumulative
  totals/progress don't change. Correct data, no private content exported —
  non-blocking, possible future optimization.
- Legacy data created before the 18-22 gate may hold 18-22 assessed too
  early; it is tolerated and never rewritten (only newly introduced
  violations block a History Edit).
- Deployment is not agent-observable (Workers Builds status is unreadable
  and Staging sits behind Access). Smallest fix, needs Tony once: a
  read-only Cloudflare token stored as a GitHub Actions secret so CI can
  verify the deployed version, or permission for the agent to open a PR so
  GitHub check runs become readable.

## Next

No pending manual acceptance. See `TASK.md` for the backlog.
