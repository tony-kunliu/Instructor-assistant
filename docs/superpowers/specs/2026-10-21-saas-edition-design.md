# SaaS Edition (self-serve sign-up + free trial) — Design

_Status: approved by Tony 2026-10-21; revised the same day after an
independent review (criteria: simple, easy to use, easy to maintain,
secure). No product code is written until Tony approves the
implementation plan._

## 1. Goal

Offer Instructor Assistant to other Canberra driving instructors as a
subscription product, phase 1 = **self-serve sign-up + free trial, no
payment yet**. Tony's and Anna's private version (current Staging and
Production, Cloudflare Access for Tony + Anna, ACTGDS integration) must
keep working exactly as it does.

Decisions Tony made (2026-10-21):

| Question | Decision |
|---|---|
| Phase 1 scope | Self-serve sign-up + free trial; no payment |
| Isolation from the private version | Same repo, separate deployment (own Worker, own D1, own hostname) |
| Login | Email one-time code |
| Tenant unit | One instructor = one account; data visible only to its owner |
| Remaining choices | "Whatever is simplest and safest" — made below |

Success = an unknown Canberra instructor can open the SaaS hostname on an
iPhone, sign in with an emailed code, fill in name + ADI number, and use
the full CBT&A lesson workflow on their own learners for 30 days, without
ever seeing another account's data and without any behaviour change in
the private version.

## 2. Architecture and mode (fail closed)

```
Private (unchanged behaviour)              SaaS (new)
instructor-assistant (Staging)             instructor-assistant-saas
instructor-assistant-production            ├─ Access app: One-time PIN, Everyone
├─ Access app: Tony + Anna only            ├─ APP_MODE = "saas"
├─ APP_MODE = "private" (now explicit)     ├─ D1 instructor-assistant-db-saas
├─ D1 migrations/                          │    migrations_dir = migrations-saas/
└─ ACTGDS integration on                   └─ ACTGDS integration off (code-enforced)
```

- `APP_MODE` must be exactly `"private"` or `"saas"`. In a deployed
  Worker (D1 bound), a missing or unknown value returns **503** for every
  request — never a silent fallback. Reason: falling back to `private`
  in the SaaS Worker would let every signed-up instructor see every
  learner. Local dev and tests (no D1 binding) default to `private`.
- In `saas` mode a missing D1 binding is also 503 (the local-dev
  pass-through must never be reachable in a SaaS deployment).
- The private environments get `APP_MODE = "private"` in `[vars]` and
  `[env.production.vars]`; nothing else about them changes.

## 3. Login: Cloudflare Access One-time PIN (no homemade auth)

- The SaaS hostname gets its own Access Application, login method
  **One-time PIN**, include policy **Everyone**. Cloudflare e-mails the
  code, throttles attempts and owns the session. No e-mail provider, no
  new secret, no auth tables.
- **Separate Zero Trust team recommended** (Tony decides in P2): the
  private apps live in team `actgds`. A separate team keeps SaaS sign-ups
  from using the same free-plan seats as Tony and Anna (about 50 users —
  Tony verifies the current number), and strangers do not see an
  "actgds" login page. The team domain becomes a per-environment var
  (`ACCESS_TEAM_DOMAIN`, default `actgds.cloudflareaccess.com`).
- Access session duration about 30 days, so iPhone users rarely re-enter
  a code.
- The verified Access JWT (signature + `aud` + issuer) stays the only
  identity source. `Everyone` means anyone can prove an e-mail address;
  authorization stays in the app.

## 4. Onboarding

In `saas` mode a verified e-mail with no instructor row is not refused:

- pages redirect to `/welcome`; API calls get `403 {"error":"onboarding_required"}`;
  static assets (manifest, icons, `/data/*`), `/welcome`, `/terms`,
  `/privacy` and `POST /api/welcome` are allowed through;
- `/welcome` asks for full name and ADI number (self-declared, not
  verified with Access Canberra; display + PDF only) and creates the
  instructor row with the verified e-mail (from a middleware-set header,
  never the body); a repeated submit returns the same instructor;
- an e-mail whose instructor is `inactive` sees a plain "This account is
  disabled" page, not a `/welcome` loop;
- `private` mode keeps today's rule (unknown e-mail → 403; never
  auto-create).
- Names may contain any characters (Chinese included): the
  `x-instructor-name` header is percent-encoded, because header values
  must be Latin-1.

## 5. Data isolation (the critical part)

Today learner reads are intentionally shared between Tony and Anna. SaaS
needs strict per-instructor isolation. It is enforced in **one place**,
middleware, plus scoped lists:

- **Route guard (saas only, middleware):** for any
  `/api/learners/<id>/...` request, the learner must belong to the
  signed-in instructor (`SELECT 1 FROM learners WHERE id = ? AND
  instructor_id = ?`), else `404`. This covers every lesson, revision,
  PDF/export, import, archive and progress route, including future nested
  ones. Also `404` in saas: `/api/learners/<id>/transfer*`,
  `PATCH /api/instructors/<id>` for anyone but oneself, and `/gps`.
- **Scoped lists:** `GET /api/learners` (active and archived, with
  summaries — the scope is bound inside the summary subqueries too) and
  `GET /api/instructors` return only the signed-in instructor's data in
  saas.
- **Paper import** matches the CSV `instructor` column against the scoped
  instructor list only (otherwise tenant A could attribute lessons to, or
  probe the names of, tenant B).
- **New learner:** in saas `instructorId` is always the signed-in
  instructor; any submitted value is ignored.
- **ACTGDS integration:** `integrationHooksFromRequestContext()` returns
  nothing in saas, whatever the vars say.
- Hardening that also helps private: `getLessonCompetencySelections`
  pairs the lesson with its learner, like `getLesson` already does.
- Out-of-scope ids are `404`, never `403`. Scope comes only from
  middleware's trusted headers; client-supplied `x-instructor-*` /
  `x-access-email` headers are always replaced or removed.
- No server component reads D1 (all data goes through `/api`), so the
  API boundary is the whole boundary.

## 6. SaaS-only schema

- Every file in `migrations-saas/` except the `9xxx` SaaS-only ones is a byte-identical copy of its file in
  `migrations/`; a test fails on any difference or missing file. Future
  shared migrations are added to both directories in the same change.
- `migrations-saas/9001_saas_setup.sql`:
  - deletes the two seed instructors `migrations/0004` inserts (Tony's
    and Anna's private accounts must not exist in the SaaS database);
  - drops the unique-name index `instructors_name_idx` (two instructors
    may share a name) and adds a unique index on `lower(email)`.
- A test applies every `migrations-saas` file and asserts: 0 instructors,
  `instructors_name_idx` absent, e-mail index present.
- The private D1 databases get **no** new migration.

## 7. Free trial

- Trial end = `instructors.created_at` + `SAAS_TRIAL_DAYS` (var, default
  30) × 24 h. No new column.
- After the trial: reads, PDF and data export stay available; every
  non-GET `/api/*` request (except `/api/welcome`) returns
  `402 {"error":"trial_expired"}`, decided in middleware. All GET routes
  are read-only, so GET cannot bypass it. The UI shows a banner and
  disables the forms.
- No payment in this phase.

## 8. Pages (iPhone first, 375 px, no horizontal scroll)

- `/welcome` — first-time profile (name, ADI number), links to terms and
  privacy.
- `/account` — trial days left, export all my data, and the existing
  Sign out link (reused, not duplicated).
- `/terms`, `/privacy` — drafted by the agent, marked DRAFT until Tony
  (or a professional) reviews them.
- Existing screens: no redesign; saas mode only hides the instructor
  picker, Transfer and the `/gps` link, and shows the trial banner.

## 9. Delivery steps

| Step | Content | Tier | Effect on the private version |
|---|---|---|---|
| P0 | Explicit `APP_MODE` (fail closed), scoped lists, scoped paper import, integration off in saas, selections hardening | **L3**, independent review | Small shared-code changes, behaviour unchanged; existing tests stay green; Production release only with Tony's separate go |
| P1 | `migrations-saas`, middleware saas gate (onboarding, trial, route guard), welcome/account/terms/privacy, saas qa-browser | L2 | None (saas-only code paths) |
| P2 | Tony: Access team/app, hostname. Agent: D1, `[env.saas]`, migrate, deploy | ALWAYS-ASK-TONY | None |

Later phases: Stripe subscription, driving school accounts with several
instructors, replacing Access if seat limits matter.

## 10. Testing

- **Route guard (pure function, real local D1):** two instructors A and
  B; every learner-keyed path and method with B's learner id as A →
  `404`; A's own → pass; transfer, other instructor's PATCH and `/gps` →
  `404`.
- **Scoped data:** A's lists (active, archived, summaries, instructors)
  contain only A; paper import naming B fails as an unknown instructor;
  integration hooks absent in saas.
- **Mode:** missing/unknown `APP_MODE` with D1 bound → 503; saas without
  D1 → 503.
- **Private regression:** the full existing suite and qa-browser pass
  unchanged.
- **Onboarding/trial:** unknown e-mail → `/welcome` (saas) / 403
  (private); case-insensitive e-mail; repeated submit → one row; same
  name allowed; inactive → disabled page; Chinese name works end to end;
  trial boundary exactly at created + 30 × 24 h.
- **Migrations:** mirror test and the §6 assertions.
- **qa-browser saas pass** at 375 px: welcome → learner → lesson → PDF;
  a second account cannot open the first's learner URL; expired trial is
  read-only; no horizontal scroll.

## 11. Needs Tony

- Approve the implementation plan.
- P0 Production release (separate go).
- P2: decide separate Zero Trust team (recommended) vs. the `actgds`
  team; create the Access app (One-time PIN, Everyone, ~30-day session);
  choose the hostname; confirm the private Access apps' policies are
  e-mail-only.
- Ask Access Canberra whether the official CBT&A competency list may be
  used in a paid product.
- Review `/terms` and `/privacy` (learner names and driving records are
  personal information under the Australian Privacy Act).
