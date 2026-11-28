# STATUS.md

_Last updated: 2026-11-24_ (Production Release #25 verified; feature work remains on PR branches)

This is the current-state snapshot. Historical detail and release receipts remain in Git history, GitHub Actions logs and the coordination issue. Fetch moving branch heads when needed. A CI pass alone is not proof of a live deployment.

## Current Snapshot

- **Production:** Main source `618c6bed647d406b6b2775f4518a82afcfb6cb75`. Main CI [40698195421](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/40698195421) and Production Release #25 [40698196068](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/40698196068) succeeded. Release #25 deployed Worker version `a46d73fa-0349-4517-a4da-9b09004c4403`; its log reports no migrations to apply. Production D1 is at `0016`, applied by Release #24 [39730474484](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/39730474484).
- **Staging Error 1101 — fixed by adapter bump (PR #142, `feature/fix-opennext-preview-props`):** every authenticated browser fetch on staging threw `Unexpected loadManifest(/.next/server/preview-props.json) call!` in `new NextNodeServer()` (5× on 2026-11-28, incl. Ray ID a61829ab4d57e8dc); the every-5-min cron always succeeded because it never constructs the Next server. Root cause: Next 16.4.6 reads `preview-props.json` at server construction, but `@opennextjs/cloudflare@1.20.6` did not inline that manifest (Dependabot PR #129 bumped Next 16.3.6 → 16.4.6 without bumping the adapter; production still runs the Oct 28 build on Next 16.3.6). Fix: `@opennextjs/cloudflare` 1.20.6 → 1.20.19, which inlines `preview-props.json` into the worker bundle (verified in the built `handler.mjs`: `readInlinedManifest` returns the file's exact JSON). Staging D1 is at `0016` (all migrations applied; verified via API 2026-11-28, correcting the older `0013` record). No business code changed.
- **Staging:** last recorded Staging CI [40719012415](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/40719012415) succeeded; D1 migration level is `0016` (verified via Cloudflare API 2026-11-28). Current GitHub evidence does not expose a reliable live Worker-to-commit mapping.
- **Branch relationship:** `main` and `staging` are diverged: Staging has 15 commits not in Main, Main has 12 commits not in Staging, and 61 paths differ. They are not synchronized; do not merge them wholesale.
- **PR #132 — Today’s lessons:** HEAD `b8b8da504fc82507f51b914b1d6d053e85944991`; CI [45183065859](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45183065859) PASS. Browser QA [45182250537](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45182250537) PASS at code SHA `333947b2aa55d47fe30f81705fcb9d13de09ac5d`; only `STATUS.md` and `TASK.md` changed afterwards. Fresh L3 review of exact HEAD is pending (ACTGDS Issue #3 comment [7102354803](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7102354803)). No live OAuth or calendar access.
- **PR #131 — licence photo:** HEAD `977e357998eaf4394e2ca268b03f993f61ba70bf`; CI [45118098357](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45118098357) PASS. Browser QA [45116531936](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45116531936) PASS at code SHA `360a2c7356afad9ae96aa6a604b3ddd5cb582b18`; only `STATUS.md` and `TASK.md` changed afterwards. Fresh L3 review of exact HEAD is pending (Issue #3 comment [7093882548](https://github.com/tony-kunliu/actgds.com/issues/3#issuecomment-7093882548)). Real iPhone camera / ACT card acceptance remains before release.
- **PR #130 — lesson GPS:** HEAD `a8337ff85936a68a43ad1a4114a4cad6240002e7`; CI [44960761857](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/44960761857) PASS; Draft. Continuous recording through lock screen and app switching is not accepted. Keep lesson integration out of release.
- **PR #133 — isolated iOS GPS:** HEAD `6f9d1b93672c3fc45fe01f6cd8351582ed8101da`; CI [45160071619](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45160071619) and Xcode project build [45160071574](https://github.com/tony-kunliu/Instructor-assistant/actions/runs/45160071574) PASS. Artifact `14810301175` is an 8,611-byte **unsigned Xcode project**, not an installable signed app; expires `2026-12-07T10:43:57Z`. Tony will arrange signing, installation and his own test when available; no external tester or reminder.
- **GPS evidence boundary:** the 22 Nov web iPhone test recorded 99.5% foreground coverage, 14.6% background coverage and an approximately 90-second gap while the page was frozen. This is web-only evidence, not native Core Location or lesson-workflow acceptance.
- No PR #130–#133 change has been merged or deployed to Staging/Production. No real calendar, real learner data, new OAuth scope, shared contract or cross-repository interface was changed.

## Repository and CI

- Main's released source is `618c6bed647d406b6b2775f4518a82afcfb6cb75` (Release #25). Staging is a moving integration branch; fetch its current head before an operation and do not store its ordinary moving SHA as durable state.
- Main CI and Production Release #25 PASS; last recorded Staging CI PASS. Feature PR run links and exact code/test SHAs are listed above.
- Workers Builds must run Memory Guard, typecheck, `npm test`, production build and Memory Guard again. `npm test` uses `--experimental-strip-types`. Workers Builds runs without Poppler utilities, so Poppler-only tests skip unless `REQUIRE_POPPLER=1` is explicitly set by the separate CI workflow.
- Standard flow: `feature/* → staging → main → Production`. Each promotion requires its own review, test and environment gates.

## Environments

**Staging**
- Worker `instructor-assistant`; D1 migration level last recorded as `0013`.
- Cloudflare Access enabled; Integration V1 enabled only in the non-Production environment.
- Verify the live Worker commit before treating a candidate as deployed; current GitHub evidence cannot establish the mapping.

**Production**
- Worker `instructor-assistant-production`; Release #25 version `a46d73fa-0349-4517-a4da-9b09004c4403`.
- D1 migration level `0016`; Release #25 applied no migration.
- Cloudflare Access enabled (Tony and Anna). Integration V1 is enabled with `ACTGDS_INTEGRATION_ENV=production`; Outbox Cron is `*/5`. `APP_MODE = "private"` must remain in both `[vars]` and `[env.production.vars]`.

## Current Product

- Learner and lesson management; CBT&A competencies 1–22, Review 1–17, Review 1–22 and Final Drive 23. Duration, distance, cumulative totals and lesson numbers are derived.
- Learner lifecycle (My learners / All / Archived, search, Archive / Restore), owner-only learner edits with revision history, instructor-owned lesson edits with revision history, paper-record import and cumulative PDF export.
- Transfer between instructors, iPad signature layout, G-NAF address suggestions, competency 23 route reminders and instructor picker (Tony ADI604, Anna ADI358).
- Overseas/interstate licence fields from migration `0013` support the Competency 23 wait rules. Photo OCR intake remains in PR #131, not released.

## Integration V1

- Contract: `actgds-instructor-assistant/v1`, event `lesson.upserted`.
- Canonical schema SHA256: `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`.
- Cross-repo compatibility PASS; coordinated non-Production Integration V1 QA PASS (ACTGDS Issue #3 comment 5880411046).
- Integration enabled: YES in Staging and Production. SaaS has no environment: Integration enabled: NO there, and migration 0005 not applied to any SaaS D1.
- Migration 0005 is applied in Staging and Production for V1. Production rollout is not authorized for any contract change; the V1 rollout itself is complete.
- The systems keep separate databases. Cross-system identity uses only a human-linked, versioned `learner_id`; never auto-match by name, phone or email. See `docs/integrations/` and ACTGDS Issue #3.

## Known Issues

- `lib/db.ts` local file-DB reopen can fail after schema initialization; use `:memory:` or Wrangler D1 migrations for local tests.
- Legacy data may contain CBT&A items 18–22 assessed too early; tolerated and never rewritten.
- Cloudflare Access `returnTo` behaviour on `/cdn-cgi/access/logout` is observed but not documented.
- Accepted PDF font coverage gaps remain for some Vietnamese, Greek, Cyrillic, kana, Hangul and uncommon symbols.
- `scripts/check-signature-row-limits.mjs` has not been run against Staging D1; never run it against Production without a separate approved task.
- SaaS has no deployed environment; before creating one, the scheduled entry must also enforce `APP_MODE`.
- Minor learner-edit review follow-ups remain in `docs/BACKLOG.md`.

## Next

See `TASK.md`.
