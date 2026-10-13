# STATUS.md

_Last updated: 2026-10-13_ (Production and Staging D1 at migration `0012`; release #14 live)

This file describes **current state only**. History lives in git log and
closed PRs; see `TASK.md` for what is in progress.

## Current Snapshot

- **Production** (all via `Production Release`, all success): #12 run 38157600087 (`main`
  `9dc4763`, PR #60: 3c T1 transfer, migration `0011`, intake P1, C23 line + PDF Eligibility;
  Worker `5ea1eb27-3dc9-4d74-ba75-0bffba7219e9`); #13 run 38277936881 (`main` `98354bc`,
  PR #64: iPad layout, intake P2 address suggestions, Operating Handbook; migration `0012`
  applied by the release; Worker `eb9fa409-5707-4524-944d-636d133202d8`); #14 run 38287641067
  (`main` `ae8d066`, PR #66: R10a Competency 23 route reminders, no migration; Worker
  `690fb2c1-5387-42fb-807f-f7b2b6db39fc`). Rollback target of each run = the previous
  run's Worker. D1 Time Travel bookmarks are only in the runs' step summaries (not in the
  logs): not recorded here.
- **Staging:** `0012` applied by `Staging D1 Migrate` run 38204269795 before P2 merged.
- **Real-device / Tony checks:** iPad layout accepted on a real iPad; route reminders and
  address suggestions (iOS "Scan Text", list vs keyboard) OK on Staging per Tony (not automated).
- **Merged to `staging` (PRs #73, #74, #77, #78, #80):** learner list redesign (tokens, navy top bar,
  cards, `GET /api/learners` `summaries`; qa-browser 20), lesson record redesign (navy header, Start →
  End, Save after End, ≥44px chips, dark theme; qa-browser 21), "only the form" while New / Edit
  learner is open + ONE light/dark toggle button in the top bar (qa-browser 22), font-subset temp-dir
  leak fixed in the PDF test. Released to Production in #15/#16 except the leak fix. Contract untouched.
- **Merged to `staging` (PR #81):** learner intake P3, overseas / interstate licence (migration `0013`,
  six nullable `learners.other_licence_*` columns; `lib/other-licence.ts`; school rule in `lib/rules.ts`;
  qa-browser 23). Staging D1 at `0013` (Staging D1 Migrate run 8, before the merge); Production D1 `0012`.
- **On a branch (L2 presentation only, one review round):** `feature/ui-learner-form` = learner form
  restyle (concept screen B: Student / Address / Licence & eligibility cards, sticky Save bar, inline
  required-name error) + Tony's decision 3: Transfer and Archive moved into the EDIT form's folded "More"
  (same panels, handlers, guards, testids). `lib/learner-form-view.ts` + test; qa-browser 24; no
  migration, no payload or rule change. Non-owner rescue transfer (inactive owner) keeps its page link.
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
  leaves Staging on the old version (happened 2026-10-09 after PR #31; fixed
  by PR #32). Before merging, simulate it locally (CI=1, `pdftotext` off PATH).

## Environments

**Staging**
- Workers Builds deploys every `staging` push to Worker
  `instructor-assistant`. The agent's token can read deployment metadata, not
  the commit mapping, so the live commit is inferred from push time.
- D1 migration level: `0012`. Apply a migration to Staging D1 BEFORE merging
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
- Before #12: runs 38153327724 (validity fix), 38106838536 (`0010`), `0006`-`0009` and
  Release B 37668118567: Worker ids in this file's git history.
- D1 migration level: `0012`. Cloudflare Access: enabled (Tony + Anna only).
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
- Cloudflare's `returnTo` on `/cdn-cgi/access/logout` is observed behaviour
  (same-origin absolute URL gives 302, else 400), not documented.
- PDF font coverage gap (accepted by Tony: names are normally English only):
  Vietnamese, Greek, Cyrillic, kana, Hangul, Latin Ext-B, box drawing and some
  symbols print as boxes after the user confirms the warning.
- Minor learner-edit review follow-ups are in `docs/BACKLOG.md`.
- `app/manifest.ts` still carries the pre-redesign `background_color` / `theme_color`
  (`#f4f2ee` / `#1d1d1f`), not the shared tokens (affects the installed-PWA splash only).

## Next

See `TASK.md`.
