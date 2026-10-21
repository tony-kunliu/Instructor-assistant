# SaaS Edition (self-serve sign-up + free trial) — Design

_Status: draft for Tony's review (2026-10-21). No product code is written
until Tony approves this spec and the implementation plan that follows it._

## 1. Goal

Offer Instructor Assistant to other Canberra driving instructors as a
subscription product, phase 1 = **self-serve sign-up + free trial, no
payment yet**. Tony's and Anna's private version (current Staging and
Production, Cloudflare Access for Tony + Anna, ACTGDS integration) must
stay exactly as it is.

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
ever seeing another account's data and without any change to the private
version's behaviour or Production D1.

## 2. Architecture

```
Private (unchanged)                        SaaS (new)
instructor-assistant (Staging)             instructor-assistant-saas
instructor-assistant-production            ├─ Access app: One-time PIN, "Everyone"
├─ Access app: Tony + Anna only            ├─ APP_MODE = "saas"
├─ APP_MODE unset → "private"              ├─ D1 instructor-assistant-db-saas
├─ D1 migrations/                          │    migrations_dir = migrations-saas/
└─ ACTGDS integration on                   └─ ACTGDS integration off
```

- `wrangler.toml` gains `[env.saas]`: its own Worker name, Access `aud`,
  D1 (`migrations_dir = "migrations-saas"`), self-reference service
  binding, `APP_MODE = "saas"`, `ACTGDS_INTEGRATION_ENABLED = "false"`,
  no Cron trigger.
- `APP_MODE` is read in one place (`lib/app-mode.ts`); anything missing
  or unknown means `private`. The private environments do not set it.

## 3. Login: Cloudflare Access One-time PIN (no homemade auth)

Simplest and safest option: reuse the Access verification the app
already does (`lib/access.ts`, `middleware.ts`) instead of writing
login, code e-mailing, rate limiting and session code ourselves.

- Tony creates a separate Access Application for the SaaS hostname with
  the **One-time PIN** login method and an **Everyone** include policy.
  Cloudflare e-mails the code, throttles attempts and owns the session.
- No e-mail provider, no new secret, no auth tables.
- Limit: Cloudflare Zero Trust's free plan covers a limited number of
  users (about 50 — Tony verifies the current number in the dashboard).
  Enough for the pilot; replacing Access or paying for seats is a later
  decision.
- The verified Access JWT (signature + `aud`, as today) is still the
  only identity source. `Everyone` means *anyone can prove an e-mail
  address*; authorization stays in the app.

## 4. Onboarding

In `saas` mode, `middleware.ts` changes one rule: a verified e-mail with
no instructor row is **not** refused. Instead:

- pages redirect to `/welcome`; API calls get `403 {"error":"onboarding_required"}`;
- `/welcome` asks for full name and ADI number (self-declared, not
  verified with Access Canberra; display + PDF only) and creates the
  instructor row with the verified e-mail;
- e-mail comparison is case-insensitive; one e-mail = one instructor;
- `private` mode keeps today's rule (unknown e-mail → 403; never
  auto-create).

## 5. Data isolation (the critical part)

Today `listLearners`, `getLearner` and related reads are intentionally
**not** filtered by instructor (Tony and Anna share learners and can
transfer them). SaaS needs strict per-instructor isolation.

- Every learner/lesson read and write in `lib/repo.ts` takes a
  `scope`: `{ kind: "all" }` or `{ kind: "instructor", id }`.
  - `private` mode always passes `all` → identical SQL results to today.
  - `saas` mode passes the signed-in instructor → `learners.instructor_id = ?`.
- Lesson, revision, PDF export, data export, paper import, progress and
  completion paths first resolve the learner **within the scope**; a
  learner outside the scope is `404` (never `403`, so existence is not
  leaked).
- Server components that read D1 directly (e.g. `app/page.tsx`) use the
  same scoped functions.
- Disabled in `saas` mode (server-side, not just hidden): learner
  transfer, instructor picker / choosing another instructor, editing
  another instructor's ADI, ACTGDS integration, `/gps`.
- Scope is derived only from the middleware's trusted headers, never
  from a request body or query string.
- In `saas` mode a new learner's or lesson's `instructor_id` is always
  the signed-in instructor; any submitted instructor id is ignored.

## 6. SaaS-only schema

`instructors_name_idx` makes `lower(full_name)` unique; two SaaS
instructors with the same name would fail to sign up.

- `migrations-saas/0001`–`0013` are byte-identical copies of
  `migrations/0001`–`0013`; a test fails if any shared migration differs
  or is missing from `migrations-saas/`. Future shared migrations are
  added to both directories in the same change.
- `migrations-saas/9001_saas_instructor_names.sql` drops
  `instructors_name_idx` and adds a unique index on `lower(email)`.
- The private D1 databases get **no** new migration.

## 7. Free trial

- Trial end = `instructors.created_at` + `SAAS_TRIAL_DAYS` (var, default
  30). No new column.
- After the trial: read and export stay available (learner list, lesson
  history, PDF, data export); every create/update API returns
  `402 {"error":"trial_expired"}`, enforced in one server-side guard.
  The UI shows a banner and disables the forms.
- No payment in this phase; how to continue after the trial is a later
  phase.

## 8. Pages (iPhone first, 375 px, no horizontal scroll)

- `/welcome` — first-time profile (name, ADI number).
- `/account` — trial days left, export all my data, log out (existing
  `lib/access-logout.ts`).
- `/terms`, `/privacy` — drafted by the agent, marked DRAFT until Tony
  (or a professional) reviews them; linked from `/welcome`.
- Existing screens: no redesign; `saas` mode only hides the disabled
  features from §5.

## 9. Delivery steps

| Step | Content | Tier | Effect on the private version |
|---|---|---|---|
| P0 | `scope` through `lib/repo.ts` + routes + server components; cross-tenant tests | **L3**, independent review | Code changes, behaviour unchanged; all existing tests stay green |
| P1 | `APP_MODE`, `[env.saas]`, `migrations-saas/`, onboarding, trial guard, `/account`, `/terms`, `/privacy`, saas-mode hiding | L2 | None (saas-only code paths) |
| P2 | Tony creates Access app, Worker, D1, hostname; agent applies `migrations-saas` and deploys | ALWAYS-ASK-TONY | None |

P0 is released to the private Production only after Tony's separate
go-ahead, because it touches the queries Tony and Anna use every day.

Later phases (not in this spec): Stripe subscription, driving school
accounts with several instructors, replacing Access if the seat limit
is reached.

## 10. Testing

- **Cross-tenant suite:** two SaaS instructors A and B; for every route
  that takes a learner or lesson id (read, create, update, revisions,
  PDF, export, import, archive), A using B's ids gets `404` and B's data
  is unchanged. Lists return only A's learners.
- **Private regression:** the full existing suite passes unchanged in
  `private` mode.
- **Onboarding:** unknown verified e-mail → `/welcome` in saas, `403` in
  private; duplicate e-mail rejected; same name allowed in saas.
- **Trial:** day 29 writes succeed; day 31 writes `402`, reads and PDF
  succeed.
- **Migrations:** `migrations-saas` mirror test; local D1 apply of both
  directories.
- **qa-browser** at 375 px: welcome → add learner → lesson → PDF;
  expired trial is read-only; another account's learner URL shows not
  found.

## 11. Needs Tony

- Approve this spec, then the implementation plan.
- P2: Cloudflare Access app (One-time PIN, Everyone), Worker, D1,
  hostname; check the Zero Trust free-plan user limit.
- Ask Access Canberra whether the official CBT&A competency list may be
  used in a paid product.
- Review `/terms` and `/privacy` (learner names and driving records are
  personal information under the Australian Privacy Act).
