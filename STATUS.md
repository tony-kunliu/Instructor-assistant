# STATUS.md

_Last updated: 2026-11-23_ (Production and Staging D1 at migration `0016`; release #24 live)

This file describes **current state only**. History lives in git log and
closed PRs; see `TASK.md` for what is in progress.

## Current Snapshot

- **Today’s lessons #132 (feature branch only):** Multiline pickup parsing now stops at adjacent phone/email labels and falls back to a valid event location. Regression tests added; not merged or deployed. Code/test commit `77cbc93` passed CI run `45100677193` (Memory Guard, type check, tests and build). Subsequent commits only update project memory; exact-head L3 re-review remains pending.
- **iOS GPS hold:** PR #133 remains a draft with its unsigned Xcode build artifact retained. Tony will arrange his own signing, installation and device test; no external tester or reminder. PR #130 remains a draft with continuous background recording acceptance as a release gate.

- **SaaS edition (2026-10-21/28):** P0 in Production (#22): fail-closed `APP_MODE` (must stay in both vars sections). P1 on
  `staging` (PR #124, L3, reviewed): `migrations-saas/`, `lib/saas/*` gate
  (onboarding, 30-day trial, ownership guard), pages, `run-saas.sh` QA. **No SaaS environment exists.** It touches shared
  files (`page.tsx`, `driver-app.tsx`, `globals.css`, `manifest.ts`, `middleware.ts`), so the next Production release needs Tony's go. Spec/plan: `docs/superpowers/*/2026-10-21-saas-edition*`.
- **Instructors:** only Tony (ADI604) and Anna (ADI358) are active in both environments; display labels live in Production (#18).

- **Production:** release #24 is the latest recorded release (`main` `002b835`; run `39730474484`), D1 migrations `0015`–`0016`, Worker `83d61f30-0d51-4dbd-be0d-dbe7ff5b529a`, rollback Worker `d716940c-62d9-4830-95ad-ac23e8ee6301`. Older release and restore-point details remain in the corresponding workflow summaries.
- **GPS phase 1 (PR #84, in Production #18):** `lib/gps` + page `/gps` (synthetic default, Real GPS behind a consent box, nothing uploaded). Design: `docs/superpowers/specs/2026-10-13-gps-tracking-design.md`. Phase 1b (Tony's real drive on Staging `/gps`) is next.
- **Still open:** `scripts/check-signature-row-limits.mjs` not yet run against a deployed
  D1 (Staging only, never Production); notify-tick (lesson notifications) waits for Website
  PR #47 rework and Tony's approval of the new endpoint + secret (Production OFF); intake
  P4; `docs/tasks` memory scheme + Memory Guard changes (Handbook §9); items in
  `docs/BACKLOG.md`.

## Repository

- **main:** everything released to Production up to #14; `git fetch` for its head.
  Release B source `d47350bcb65fa46d3135d1dbeec52882f7012886`; rollback baseline before
  Release A `8bae4e4c211a78b2e682d8b04744f102fa1a4328`.
- **staging:** same product code as `main` (`main` also carries 3 workflow files merged
  there directly). Its HEAD moves; do not record an exact SHA here.

## CI

- Latest `staging` GitHub Actions run: **SUCCESS**. 2 poppler tests skip without `pdftotext`; they hard-fail only with `REQUIRE_POPPLER=1`,
  set in `ci.yml` only).
- `npm test` needs `--experimental-strip-types` (already in `package.json`).
- **Workers Builds** runs `node scripts/check-project-memory.mjs && npm run
  typecheck && npm test && npm run cf:build && node scripts/check-project-memory.mjs`
  with CI set and no poppler-utils. Anything that fails `npm test` there
  leaves Staging on the old version. Before merging, simulate it locally (CI=1, `pdftotext` off PATH).

## Environments

**Staging**
- Workers Builds deploys every `staging` push to Worker
  `instructor-assistant`. The agent's token can read deployment metadata, not
  the commit mapping, so the live commit is inferred from push time.
- D1 migration level: `0013`. Apply a migration to Staging D1 BEFORE merging
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
- D1 migration level: `0012`. Cloudflare Access: enabled (Tony + Anna only).
- Integration enabled: **YES**, `ACTGDS_INTEGRATION_ENV=production`, Receiver
  `https://actgds.com/api/integrations/instructor-assistant/events`,
  `ACTGDS_WEBHOOK_SECRET` set by Tony. Outbox Cron `*/5`. No backfill.
- Real end-to-end link verified 2026-10-10 (detail: git history, actgds.com Issue #3).
- `APP_MODE = "private"` in `[vars]` and `[env.production.vars]` is required (missing → 503
  everywhere); pinned by `tests/wrangler-app-mode.test.ts`.

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
  were Achieved in EARLIER lessons; enforced server-side, legacy data never
  rewritten (Review / Final Drive validity derived by lesson order). Save
  errors show jump links.
- CBT&A Checklist PDF export with an embedded compact font subset (about 0.2
  MB typical, was ~14 MB); Export shows "PDF ready: <size> (compact font)".
  Full 16 MB font only for rare CJK characters. Access-gated sign-in; "Copy
  Integration ID" for manual ACTGDS CRM linking.
- Transfer a learner to another instructor (3c T1, `0011`); iPad layout (fixed 640×320
  signature canvas, 700k-char limit); Address suggestions from a bundled G-NAF street index
  (`0012`, 3 nullable suburb/state/postcode columns); "Competency 23 from" + PDF Eligibility
  auto-fill; Competency 23 route reminders (R10a). None of these sends anything to ACTGDS.
  On the branch only: overseas / interstate licence fields (`0013`) feeding the Competency 23
  reminders (Tony's school rule: interstate learner time counts; interstate or overseas FULL
  licence held 12 months removes the wait; overseas learner does not count; expiry not read).
- Working rule: `AGENTS.md` §13, standing authorizations §14 (new-endpoint/secret
  exclusion 2026-10-12), model choice §9; two-repo Operating Handbook
  `docs/OPERATING_HANDBOOK.md` approved by Tony 2026-10-12 (§16).

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
- ACTGDS side (not this repo): My Driving (student page) is live in Production (released by Work). Tony's display polish list (readable competency
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
- Cloudflare's `returnTo` on `/cdn-cgi/access/logout` (same-origin absolute URL → 302, else 400) is observed, not documented.
- PDF font coverage gap (accepted by Tony: names are normally English only):
  Vietnamese, Greek, Cyrillic, kana, Hangul, Latin Ext-B, box drawing and some
  symbols print as boxes after the user confirms the warning.
- Minor learner-edit review follow-ups are in `docs/BACKLOG.md`.
- SaaS: `worker/scheduled-entry.ts` ignores `APP_MODE` (check it with `[env.saas]`). A shared migration that rebuilds `instructors`
  needs a `9xxx` companion in `migrations-saas/`. Saas `/gps` 404 is JSON; prerendered not-found pages carry the ACTGDS title.
  First P2 check: `APP_MODE=saas` without `ACCESS_AUD` must answer 503 (the `middleware.ts` composition has no unit test).
- qa-browser route-line check failed only on Canberra Sundays (`r3-day` id, correct behaviour); fix on `fix/qa-route-reminder-order`, verify on Sun 2026-10-25.
- `app/manifest.ts` still carries the pre-redesign `background_color` / `theme_color`
  (`#f4f2ee` / `#1d1d1f`), not the shared tokens (affects the installed-PWA splash only).

## Next

See `TASK.md`.
