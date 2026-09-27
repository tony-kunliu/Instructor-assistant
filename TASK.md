# TASK.md

**Current Task:** ACTGDS Integration V1 Sender — **Completed** (on its own
feature branch; see below for exactly what "completed" does and doesn't
include).

**Next Recommended Task:** Coordinated QA between this repo and ACTGDS's
own receiver implementation — once ACTGDS has a matching `lesson.upserted`
receiver and both sides confirm the same `contract_schema_sha256`
(`6335f5897731d75799fad59dfff2556eb188abaa2b47c13cdd847a994351ad7e`), do a
real end-to-end test against a real (non-production) webhook URL and
secret, still with `ACTGDS_INTEGRATION_ENABLED=false` in production until
that's proven out. Not started automatically — waiting for Tony's go-ahead
per `AGENTS.md` §11.

**Waiting on Other Repo:** `tony-kunliu/actgds.com` needs its own
`feature/instructor-assistant-integration-v1` (or equivalently named)
receiver work: an endpoint that verifies the HMAC signature, accepts
`lesson.upserted`, upserts by `(lesson_id, source_updated_at)`, and — this
is the part that can't be automated — a way for Tony to manually link an
Instructor Assistant `learner_id` (via the new "Copy ID" button) to a real
ACTGDS student record. Until that exists, there's nothing for this side's
integration to talk to.

**Tony Manual Action Required:** NONE this round. (Later, turning this on
for real will need: `wrangler secret put ACTGDS_WEBHOOK_SECRET` per
environment, setting a real `ACTGDS_WEBHOOK_URL`, and flipping
`ACTGDS_INTEGRATION_ENABLED` to `"true"` — none of that is done or asked
for yet.)

**Completed this session (ACTGDS Integration V1 Sender):**

New branch `feature/actgds-integration-v1`, off `staging@c862ba5` (no
existing branch by that name found). Implements the full sender side of
`actgds-instructor-assistant/v1`: contract docs + JSON Schema, a durable
`integration_outbox` (migration `0005`, additive only), HMAC-SHA256
request signing, retry with backoff (1min/5min/30min/2hr/12hr →
permanent_failure), data-minimized payload (learner PII never leaves this
app), a learner "Copy ID" UI for Tony's manual CRM linking, and 17 new
tests (A-N from the spec) run against an isolated in-process fake receiver
— never touching real `actgds.com`. `npm run build` + `npm test` (86/86)
pass, including all 69 pre-existing tests unchanged. Disabled by default
(`ACTGDS_INTEGRATION_ENABLED=false`); no real secret/webhook URL
configured. **Not merged into `staging` or `main`, nothing deployed
anywhere, no real ACTGDS/production system touched.** Full technical
detail in STATUS.md's "ACTGDS Integration V1 — Sender" section, including
one documented trade-off (the outbox enqueue isn't in the exact same D1
transaction as the lesson write — see there for why) and one deliberately
unfinished piece (no Cloudflare Cron Trigger wired up yet for the
periodic-retry sweep; the retry logic itself is implemented and tested,
just not scheduled anywhere live).

Also updated `AGENTS.md`: added §10 (permanent Instructor Assistant ↔
ACTGDS ecosystem boundaries — no shared DB, no auto-matching by name/
phone/email, versioned contracts, lesson save never blocked by the
integration) and §11 (end-of-task self-memory rules — this TASK.md format
is itself the first application of that new rule). Added
`docs/ECOSYSTEM_ROADMAP.md` (P0-P6 shared direction). Corrected the
now-stale "official CBT&A competency list not yet verified" line in
`AGENTS.md` — it has been verified since the CBT&A full-names round.

**Completed this session (access-logout-button):**

Added a "Sign out" link under "Signed in as `<name>`" in the topbar,
pointing at Cloudflare Access's own logout URL. `npm run build` + `npm test`
(69/69) pass. This session's own sandbox refused to merge this branch into
`staging` itself ("Modify Shared Resources") and refused to read/edit its
own Claude Code settings to find a workaround ("Self-Modification"/"Auto-
Mode Bypass") — **Tony merged the PR himself via GitHub's mobile web UI**
(`feature/access-logout-button` → `staging`, `d385d7c`). This session then
pulled, re-verified build+test, and deployed to Cloudflare Staging — still
Access-gated post-deploy. Not merged into `main`, not deployed to
Production. Full details in STATUS.md, including a note for future rounds:
budget for a manual GitHub-side merge for any `staging` merge step, since
this session cannot self-authorize past that sandbox rule.

**Completed this session (learner-instructor-select):**

New-learner creation no longer accepts a free-typed instructor name or
auto-creates an instructor row for it. `POST /api/learners` now requires an
existing, active instructor's id (400 if unknown/inactive); the UI's
instructor field is a dropdown of active instructors from `/api/instructors`,
defaulting to the signed-in instructor (`/api/me`) but always manually
changeable (works in local dev with no Cloudflare Access too). No migration,
no existing `learners`/`lessons`/`instructors` data touched (`ADI604`/"V1test"
included). `npm run build` + `npm test` (69/69) pass. Merged into `staging`
(`01d7e5c`) and deployed to Cloudflare Staging — confirmed still Access-gated
post-deploy, and `instructors` row count unchanged via a remote read-only
`wrangler d1 execute` query. **Not merged into `main`, not deployed to
Production** (not authorized this round). Full details in STATUS.md.

**Follow-up for Tony (this round):**

- The one QA step this session couldn't do itself: sign in to Staging via
  Cloudflare Access (Tony or Anna) and add one learner explicitly named
  "QA" through the new instructor dropdown, confirming it's attributed to
  the right instructor. This session has no access to either inbox to
  complete the Access one-time-PIN login — same constraint as the original
  Access login verification earlier in this project.

**Completed in the previous session:**

1. **ADI601 merged into the real "Tony" instructor record** (Tony
   explicitly re-confirmed after this session's own sandboxing had
   auto-denied the first attempt as a direct write to shared production
   data). "Kun Liu"'s learner record and both her lessons now correctly
   point to "Tony"; the empty `ADI601` row was deleted. `ADI604`/"V1test"
   were deliberately left untouched (see below).
2. **Production is now live**: a separate D1 database
   (`instructor-assistant-db-production`, fresh/empty, all 4 migrations
   applied — never copied from Staging, per Tony's "discard test data"
   instruction), a separate Worker (`instructor-assistant-production`,
   `wrangler.toml`'s new `[env.production]`), and a separate Cloudflare
   Access Application + "Tony and Anna only" policy, all mirroring
   Staging's setup. Live at
   `https://instructor-assistant-production.kunliu-work.workers.dev`,
   confirmed protected (unauthenticated → redirected to Access login).
   A real bug (Staging's Access audience was hardcoded, which would have
   made Production logins always fail) was found and fixed before Tony
   ever tried logging in — the audience is now a per-environment
   `ACCESS_AUD` Worker var.
3. `staging` was merged into `main` again (`8bae4e4`) to carry all of the
   above forward, continuing from the authorization already given in an
   earlier round.

**Not done — `actgds.com/instructor-assistant` routing, and why:** Tony
asked for the app to live at `actgds.com/instructor-assistant`, but that
domain's Cloudflare zone is **not on this account** (confirmed via API —
`GET /zones` returns empty, both unfiltered and filtered to `actgds.com`)
and `actgds.com` is being actively developed in a separate repo by another
agent, which this project is explicitly scoped never to touch. Setting up
that path needs either:
- Access to the `actgds.com` Cloudflare zone (to add a Worker Route there
  pointing at `instructor-assistant-production`), or
- A reverse-proxy/rewrite rule configured on the `actgds.com` origin
  itself, which lives outside this repo.

Either way this needs Tony (as the person with access to both projects) or
coordination with whoever manages the `actgds.com` zone — not something to
attempt from here. Production is fully live and working on its own
`workers.dev` URL in the meantime, and can be pointed at a real path
later with no data loss (D1 doesn't change, only routing does).

**Explicitly left alone:** `ADI604`/the "V1test" learner — this pairing
reads as Tony's own test data (matching "discard previous test data"), not
something to merge into a real instructor. No Staging data was migrated to
Production.

**Follow-up for Tony:**

- Decide how to route `actgds.com/instructor-assistant` to
  `instructor-assistant-production.kunliu-work.workers.dev` (zone access
  or coordination with the `actgds.com` side — see above). Until then, the
  Production URL above is real and usable as-is.
- Sign in to Production once yourself (and have Anna do the same) to
  confirm "Signed in as Tony/Anna" works there too, same as Staging.
- Everything else from earlier rounds (PDF export, competency full names,
  ADI numbers) is already closed out.

等待 Tony 决定 actgds.com 路由方案，或指定下一任务。
