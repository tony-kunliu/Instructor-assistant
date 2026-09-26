# TASK.md

No active development task.

**Completed this session:**

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
3. `staging` was merged into `main` again (`b6907de`) to carry all of the
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
