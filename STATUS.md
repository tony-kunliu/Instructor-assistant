# STATUS.md

_Last updated: 2026-10-10_ (Production at migration `0008`; Staging D1 at `0008`; T1 and T2 rules reminders implemented on branches, not merged; T2 needs migration `0009`)

This file describes **current state only**. History lives in git log and
closed PRs; see `TASK.md` for what is in progress.

## In progress (branch, not merged)

- `feature/rules-reminders-t1` (spec `docs/superpowers/specs/2026-10-10-rules-reminders-and-learner-phase2-design.md`,
  T1): display-only reminders for R1 (36 h before Review 1-17 / 1-22), R3
  (Competency 23 days and hours), R5 (learner licence) and an ADI Audit
  booking link; `lib/rules.ts`, `lib/act-public-holidays.ts` (2026-2027, from
  the Holidays Act 1958 and NI2026-154 / NI2026-387; yearly update is a
  BACKLOG item), `achievedLessonIds` in progress. No migration, no ACTGDS
  contract change, 0 extra D1 statements.
- `feature/rules-reminders-t2` (on top of T1): migration `0009` (five nullable
  learner columns: licence issue date, first issue date, HPT date, logged
  hours + as-of date), validation D19, revision snapshots, a collapsed
  "Competency 23 eligibility" group in the New/Edit learner forms, and the R2
  reminder (issue date estimated from the licence expiry when empty; "Borderline,
  check the licence card" within 14 days of a threshold). ACTGDS contract
  unchanged. Learner edit stays 5 D1 statements (UPDATE binds up to 16).
  **Apply 0009 to Staging D1 (Staging D1 Migrate, ref = branch, confirm =
  staging) BEFORE merging T2 to `staging`.**

## Repository

- **main:** has everything released to Production (Release B, P1b, lesson
  ownership + revisions, learner edit Phase 1, compact PDF font, CI fix);
  `git fetch` for its head. Release B source
  `d47350bcb65fa46d3135d1dbeec52882f7012886`; rollback baseline before
  Release A `8bae4e4c211a78b2e682d8b04744f102fa1a4328`.
- **staging:** carries the same code plus docs. Its HEAD moves; do not record
  an exact SHA here.

## CI

- Latest `staging` GitHub Actions run: **SUCCESS**. Tests: 485 on the T2 branch (465 on T1), 404 on staging (2 poppler
  tests skip without `pdftotext`; they hard-fail only with `REQUIRE_POPPLER=1`,
  set in `ci.yml` only).
- `npm test` needs `--experimental-strip-types` (already in `package.json`).
- **Workers Builds** runs `node scripts/check-project-memory.mjs && npm run
  typecheck && npm test && npm run cf:build && node scripts/check-project-memory.mjs`
  with CI set and no poppler-utils. Anything that fails `npm test` there
  leaves Staging on the old version (happened 2026-10-09 after PR #31; fixed
  by PR #32). Before merging, simulate it locally (CI=1, `pdftotext` off PATH).

## Environments

**Staging**
- Workers Builds deploys every `staging` push to Worker
  `instructor-assistant`. The agent's token can read deployment metadata, not
  the commit mapping, so the live commit is inferred from push time.
- D1 migration level: `0008`. Apply a migration to Staging D1 BEFORE merging
  code that needs it to `staging`, with the manual workflow `Staging D1
  Migrate` (`staging-migrate.yml`, on `main`; inputs `ref` = a branch,
  `confirm` = `staging`).
- Cloudflare Access: enabled. Integration enabled: YES (non-Production).

**Production**
- Releases: manual workflow `Production Release`
  (`.github/workflows/production-release.yml`, `main` only,
  `confirm=production`); token only in GitHub Secrets; each run records the
  rollback version and a D1 Time Travel restore point. See
  `docs/RELEASE_B_RUNBOOK.md`.
- Released 2026-10-08/09 (all on `main`, all succeeded): P1b paper import +
  prior-instructor records, `0006` (run 37796457888, Worker
  `96228a32-5f32-42b5-8f0d-7985e59c5d82`); lesson edit ownership + revisions,
  `0007` (run 37806351565); learner edit Phase 1, `0008` (run 37891106278);
  compact PDF font + CI fix (run 37907021677). Run 37668118567 was Release B
  (rollback target `08ca0c75-cd97-44fa-87ec-ed0f7e6efbae`).
- D1 migration level: `0008`. Cloudflare Access: enabled (Tony + Anna only).
- Integration enabled: **YES**, `ACTGDS_INTEGRATION_ENV=production`, Receiver
  `https://actgds.com/api/integrations/instructor-assistant/events`,
  `ACTGDS_WEBHOOK_SECRET` set by Tony. Outbox Cron `*/5`. No backfill.
- **Real end-to-end link verified 2026-10-10 (Canberra):** a paper-imported
  learner's first App lesson (#3; cumulative includes prior-instructor and
  paper hours/km) was received by ACTGDS and shown in its Admin panel after
  the learner was linked in the ACTGDS CRM. ACTGDS ACKed the mid-sequence first
  event on Issue #3 (2026-10-08). That test learner (a renamed transferred
  paper-import learner) now has a test lesson #3 in history and PDF;
  Production data is never deleted, correct it through History Edit.

## Current Product

- Learner + lesson management, CBT&A competencies 1-22, Review 1-17, Review
  1-22, Final Drive 23; derived-only duration/km/cumulative totals, lesson
  numbering. History Edit recalculates downstream totals and milestones.
- Learner list: My learners / All / Archived, search, Archive / Restore (no
  Integration event). Learner edit (owner only; `PATCH /api/learners/[id]`,
  previous values kept in `learner_revisions`, no ACTGDS event; revisions not
  displayed). Lesson edit only by the lesson's own instructor (CoP 9.2); each
  edit snapshots the old values (`lesson_revisions`); History shows "Edited N
  times", PDF marks "(amended)".
- Paper Records Import (P1b) and PDF cumulative line per page (P1a); paper and
  prior-instructor rows never emit Integration events.
- CBT&A chronology: a lesson may Assess a gated item only if its prerequisites
  were Achieved in EARLIER lessons; enforced server-side, legacy violations
  tolerated. Save errors show jump links.
- CBT&A Checklist PDF export with an embedded compact font subset (about 0.2
  MB typical, was ~14 MB); Export shows "PDF ready: <size> (compact font)".
  Full 16 MB font only for rare CJK characters. Access-gated sign-in; "Copy
  Integration ID" for manual ACTGDS CRM linking.
- Working rule: `AGENTS.md` §13, standing authorizations §14.

## Integration V1

- **Contract:** `actgds-instructor-assistant/v1`, event `lesson.upserted`.
  Schema hash `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`
  (`jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum`).
- **Cross-repo compatibility:** PASS.
- **Coordinated non-Production Integration V1 QA: PASS** (Issue #3, comment
  5880411046; blockers: NONE).
- Migration `0005` was not applied to Production until the rollout; it is now
  applied on Staging and Production.
- **Production rollout is NOT authorized for any contract change** without
  Tony's separate explicit authorization; the V1 rollout itself is done.
- ACTGDS side (not this repo): My Driving Phase 2 (student page) passed
  non-Production acceptance; its Production release awaits Tony's separate
  authorization (Website Work). Tony's display polish list (readable competency
  names, separate "achieved this lesson" vs overall progress, show "not
  achieved", lesson number and cumulative totals in the Admin Instructor
  Assistant card, clearer manual lesson-note block, less double entry,
  consistent language) goes to Work. "Synced at" = when ACTGDS received the
  event (correct).

Detail: `docs/integrations/actgds-instructor-assistant-v1.md`; coordination
record: `tony-kunliu/actgds.com` Issue #3.

## Known Issues

- `lib/db.ts` runs `SCHEMA_SQL` on every local file-DB open; it fails on
  reopen (0003 ALTER) and re-runs the 0006 rebuild. Use `:memory:` or
  `wrangler d1 migrations apply`.
- Legacy data may hold 18-22 assessed too early; tolerated, never rewritten.
- Cloudflare's `returnTo` on `/cdn-cgi/access/logout` is observed behaviour
  (same-origin absolute URL gives 302, else 400), not documented.
- PDF font coverage gap (accepted by Tony: names are normally English only):
  Vietnamese, Greek, Cyrillic, kana, Hangul, Latin Ext-B, box drawing and some
  symbols print as boxes after the user confirms the warning.
- Minor learner-edit review follow-ups are in `docs/BACKLOG.md`.

## Next

See `TASK.md`.
