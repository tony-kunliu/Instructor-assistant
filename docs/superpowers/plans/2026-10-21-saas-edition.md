# SaaS Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a separately deployed, self-serve SaaS edition (Access One-time PIN login, per-instructor isolation, 30-day trial) without changing the private Tony/Anna version's behaviour.

**Architecture:** One codebase, explicit `APP_MODE` (`private` | `saas`, fail closed). SaaS isolation lives in one pure, tested decision function (`lib/saas/gate.ts`) that `middleware.ts` applies to every request: onboarding, trial, and a learner-ownership guard on every `/api/learners/<id>/...` path. Lists and paper import take a `Scope`. Private routes keep today's behaviour.

**Tech Stack:** Next.js 16 on Cloudflare Workers (OpenNext), D1 (tests: `openTestD1()` on `node:sqlite`), `node:test`, Playwright qa-browser.

**Spec:** `docs/superpowers/specs/2026-10-21-saas-edition-design.md`

## Global Constraints

- Private mode behaviour unchanged: the whole existing `npm test` and `bash scripts/qa-browser/run.sh` pass with no edited expectations.
- No new file in `migrations/`; private D1 databases get nothing.
- `APP_MODE` is exactly `"private"` or `"saas"`; deployed (D1 bound) + missing/unknown → 503. Saas + no D1 → 503. No D1 + not saas (local dev/tests) → `private`.
- Out-of-scope ids → `404`, never `403`. Scope only from middleware headers; middleware always replaces/removes client `x-instructor-id`, `x-instructor-name`, `x-access-email`.
- `x-instructor-name` is `encodeURIComponent`-encoded by middleware and decoded by its only reader, `app/api/me/route.ts`.
- Trial: writes allowed while `now < createdAt + SAAS_TRIAL_DAYS × 24 h` (default 30); afterwards non-GET `/api/*` except `/api/welcome` → `402 {"error":"trial_expired"}`.
- Onboarding: pages → redirect `/welcome`; API → `403 {"error":"onboarding_required"}`; inactive → "This account is disabled" page / `403 {"error":"account_disabled"}`.
- iPhone first: new screens work at 375 px, no horizontal scroll; dates via `canberraDateTime()`.
- Before each code commit: `npm run typecheck && npm test && npm run build && node scripts/check-project-memory.mjs` (+ `bash scripts/qa-browser/run.sh` at the end of each PR). Each PR updates `STATUS.md` / `TASK.md` (AGENTS.md §11).
- Every wrangler command for the SaaS environment carries `--env saas` (the default target is Staging).

## Review Focus

- A SaaS Worker deployed without `APP_MODE` or without its D1 binding → 503, never private-mode or local pass-through (Task 1 tests).
- Paper import CSV naming another tenant's instructor → "not an active instructor", lesson not written (Task 2 test).
- Chinese name `刘坤` through `/welcome` → every later request works, `/api/me` shows `刘坤` (Task 4 test).
- Own learner id + another learner's lesson id on `GET` lesson and competency selections → 404 (Task 2 test).
- `Coach@X.test` vs `coach@x.test`, and a double-tapped welcome submit → one instructor (Task 4 test).

---

## P0 — Shared code (behaviour unchanged in private) · one PR · L3

### Task 1: Explicit app mode and Scope

**Files:**
- Create: `lib/app-mode.ts`, `lib/scope.ts`
- Modify: `middleware.ts` (mode check before the Access check), `wrangler.toml` (`APP_MODE = "private"` in `[vars]` and `[env.production.vars]`)
- Test: `tests/app-mode.test.ts`

**Interfaces:**
- Produces: `type AppMode = "private" | "saas"`; `resolveAppMode(raw: unknown, hasDb: boolean): AppMode | "invalid"` (`"private"`/`"saas"` exact → itself; otherwise `hasDb ? "invalid" : "private"`); `currentAppMode(): AppMode` (reads `getCloudflareContext().env`; `"invalid"` → throws); `type Scope = { kind: "all" } | { kind: "instructor"; instructorId: string }`; `scopeFor(mode: AppMode, instructorId: string | null): Scope` (saas + empty id throws); `requestScope(request: Request): Scope`.

- [ ] **Step 1: Failing tests:** `resolveAppMode("saas", true) === "saas"`; `("private", true) === "private"`; `(undefined, true)`, `("SAAS", true)`, `("prod", true)` → `"invalid"`; `(undefined, false) === "private"`; `scopeFor("private", "i1")` → `{ kind: "all" }`; `scopeFor("saas", "i1")` → `{ kind: "instructor", instructorId: "i1" }`; `scopeFor("saas", null)` and `("saas", "")` throw. Middleware decision helper `modeGate(rawMode, hasDb)` → `{ status: 503 }` for invalid, and for `("saas", false)`; `null` (continue) for `("private", false)` and `("private", true)`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; middleware calls `modeGate` first; add the two `APP_MODE = "private"` lines to `wrangler.toml`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(saas): explicit fail-closed app mode and scope`.

### Task 2: Scoped data paths

**Files:**
- Modify: `lib/repo.ts` (`listActiveInstructors` ~214, `learnerSummariesSql` ~302, `listLearners` ~295, `listLearnerSummaries` ~331, `importPaperLessons` ~1147, `getLessonCompetencySelections` ~1766), `lib/api.ts`, `lib/integration/context.ts`, `app/api/learners/route.ts`, `app/api/instructors/route.ts`, `app/api/learners/[id]/import/route.ts`, `app/api/learners/[id]/lessons/[lessonId]/route.ts`
- Test: `tests/tenant-scope.test.ts`

**Interfaces:**
- Consumes: `Scope`, `requestScope`, `currentAppMode` (Task 1).
- Produces: `listLearners(db, { archived?, scope? })`, `listLearnerSummaries(db, { archived?, scope? })`, `listActiveInstructors(db, scope?)`, `importPaperLessons(db, learnerId, csvText, mode, scope?)` — `scope` defaults to `{ kind: "all" }`; `getLessonCompetencySelections(db, learnerId, lessonId)`; `readJsonForNewLearner(request, scope)` in `lib/api.ts`.

- [ ] **Step 1: Failing tests** (`openTestD1()`, instructors `QA Coach A` / `QA Coach B`, each with one active learner, one archived learner, one lesson):
  - `listLearners(db, { scope: A })` → only A's active; `{ archived: true, scope: A }` → only A's archived; no scope → all four.
  - `listLearnerSummaries(db, { scope: A })` keys ⊆ A's learner ids, and its SQL binds the scope inside the event and transfer subqueries (assert B's lesson count does not appear).
  - `listActiveInstructors(db, A)` → `[A]`.
  - `importPaperLessons(db, aLearner, csvNaming("QA Coach B"), "preview", A)` → `PaperImportError` mentioning `"QA Coach B" is not an active instructor`; with `{ kind: "all" }` it previews.
  - `getLessonCompetencySelections(db, aLearner, bLesson)` → empty selections.
  - `readJsonForNewLearner(req({ instructorId: "other" }), { kind: "instructor", instructorId: "me" })` → `instructorId === "me"`; with `all` keeps `"other"`.
  - `integrationHooksFromRequestContext` returns `undefined` when mode is saas even with `ACTGDS_INTEGRATION_ENABLED = "true"` (test via an exported pure `hooksFor(mode, env)`).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; routes pass `requestScope(request)`; update the existing callers of `getLessonCompetencySelections` (the lesson route and `tests/d1-query-budget.test.ts`, call arguments only).
- [ ] **Step 4:** Full checks + `bash scripts/qa-browser/run.sh` → PASS (private unchanged).
- [ ] **Step 5:** Commit `feat(saas): scoped lists, paper import and integration`; update `STATUS.md`/`TASK.md`; push `feature/saas-p0-shared`; independent L3 review; PR to `staging`. **Stop before Production; ask Tony.**

## P1 — SaaS mode (saas-only paths) · one PR · L2

### Task 3: SaaS migrations directory

**Files:**
- Create: `migrations-saas/` = a byte copy of every file in `migrations/` (`0001` … `0016` at 2026-10-28), plus `migrations-saas/9001_saas_setup.sql`
- Modify: `lib/db.ts` — add `openSaasTestD1(): D1Database` (in-memory, applies every `migrations-saas/*.sql` in order)
- Test: `tests/saas-migrations.test.ts`

- [ ] **Step 1: Failing tests:** every `migrations/*` file exists in `migrations-saas/` with identical bytes; extra files only `^9\d{3}_`; after `openSaasTestD1()`: `SELECT COUNT(*) FROM instructors` = 0, `instructors_name_idx` absent, `instructors_email_idx` present; two instructors named `QA Same Name` insert; `QA@x.test` then `qa@x.test` fails.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** `9001`: delete the two `0004` seed ids, `DROP INDEX IF EXISTS instructors_name_idx`, `CREATE UNIQUE INDEX IF NOT EXISTS instructors_email_idx ON instructors (lower(email))`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(saas): saas migrations directory`.

### Task 4: SaaS gate in middleware, accounts, welcome API

**Files:**
- Create: `lib/saas/accounts.ts`, `lib/saas/gate.ts`, `app/api/welcome/route.ts`
- Modify: `middleware.ts`, `lib/access.ts` (team domain from `ACCESS_TEAM_DOMAIN`, default `actgds.cloudflareaccess.com`), `app/api/me/route.ts`
- Test: `tests/saas-gate.test.ts`, `tests/saas-accounts.test.ts`

**Interfaces:**
- Consumes: `openSaasTestD1` (Task 3), `currentAppMode` (Task 1).
- Produces:
  - `findSaasInstructor(db, email): Promise<{ id: string; fullName: string; status: string; createdAt: string } | null>` (case-insensitive)
  - `createSaasInstructor(db, { email, fullName, adiNumber })` → same shape; `INSERT OR IGNORE` then `SELECT` (idempotent); `fullName` trimmed 1–80, `adiNumber` trimmed 1–20, else `ValidationError`
  - `saasGate(db, { email, method, pathname, now, trialDays }): Promise<GateResult>` where `GateResult = { kind: "pass"; instructor?: { id; fullName } } | { kind: "redirect"; to: "/welcome" | "/disabled" } | { kind: "error"; status: 402 | 403 | 404; error: string }`
  - `forwardHeaders(request: Request, instructor: { id; fullName } | null, email: string | null): Headers`
  - `/api/me` adds `mode` and, in saas, `trialEndsAt`.

- [ ] **Step 1: Failing tests** (`openSaasTestD1()`, A and B):
  - Onboarding: no instructor + `GET /` → redirect `/welcome`; `GET /welcome`, `/terms`, `/privacy`, `/manifest.webmanifest`, `/icon.png`, `/data/x.json`, `POST /api/welcome` → pass; `GET /api/learners` → 403 `onboarding_required`. Inactive → redirect `/disabled` / API 403 `account_disabled`.
  - Trial (A created `2026-01-01T00:00:00.000Z`, 30 days): `POST /api/learners` at `2026-01-30T23:59:59.999Z` → pass; at `2026-01-31T00:00:00.000Z` → 402; `GET /api/learners/<a>/export` on day 40 → pass.
  - Route guard: as A, each of `GET /api/learners/<b>`, `PATCH /api/learners/<b>`, `GET|PATCH /api/learners/<b>/lessons/<l>`, `POST /api/learners/<b>/lessons/<l>/sign`, `GET|PUT /api/learners/<b>/import-draft`, `POST /api/learners/<b>/lessons`, `GET /api/learners/<b>/export`, `POST /api/learners/<b>/import`, `GET /api/learners/<b>/lessons/<l>/revisions`, `GET /api/learners/<b>/archive-history`, `/api/learners/%2e%2e/x` and unknown id → 404; same paths with `<a>` → pass; `POST /api/learners/<a>/transfer`, `/transfer/checked`, `PATCH /api/instructors/<b>`, `GET /gps` → 404; `PATCH /api/instructors/<a>` → pass.
  - Own-scope endpoints (no learner id, identity from the trusted header only): `GET /api/unsigned-lessons` as A lists only A's unsigned lessons; `GET|PUT /api/me/signature` touches only A's row.
  - Accounts: create then find with `COACH@X.TEST` → same id; second create with same e-mail → same id, row count 1; `刘坤` round-trips through `forwardHeaders` + `/api/me` decoding.
  - `forwardHeaders` drops client `x-instructor-id`, `x-instructor-name`, `x-access-email` and sets only trusted values (`x-access-email` only when `instructor` is null).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. Middleware: `modeGate` → Access verify (team from env) → `saas` ? `saasGate` + `forwardHeaders` : today's private path (with encoded name). `POST /api/welcome` reads `x-access-email` only.
- [ ] **Step 4:** `npm run typecheck && npm test` → PASS.
- [ ] **Step 5:** Commit `feat(saas): middleware gate, onboarding, trial`.

### Task 5: SaaS pages and qa-browser

**Files:**
- Create: `app/welcome/page.tsx`, `app/disabled/page.tsx`, `app/account/page.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/api/account/export/route.ts`, `lib/saas/trial-banner.ts`, `scripts/qa-browser/saas.mjs`
- Modify: `app/driver-app.tsx` (use `/api/me` `mode`/`trialEndsAt`: hide picker, Transfer, `/gps` link; banner; disable forms when expired; link to `/account`), `scripts/qa-browser/run.sh` (saas pass)
- Test: `tests/saas-pages.test.ts`, qa-browser `saas.mjs`

- [ ] **Step 1: Failing tests:** `trialBanner(trialEndsAt, now)` → `"Free trial: 12 days left"`, last day `"Free trial: last day"`, after → `"Free trial ended — read-only. Your records and PDFs stay available."`; `/api/account/export` builder in scope A contains only A's learners and lessons.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Pages in existing styles; `/account` reuses the existing Sign out link; `/terms` and `/privacy` start with `DRAFT — not yet reviewed`. `run.sh` saas pass in its throw-away copy: `APP_MODE = "saas"`, `migrations_dir = "migrations-saas"`, stub middleware that takes the e-mail from `x-qa-email` and calls the real `saasGate` + `forwardHeaders`; readiness probe `GET /api/me` and assert `mode === "saas"`.
- [ ] **Step 4:** `saas.mjs` at 375 px: new e-mail → `/welcome` (name `QA 刘坤`) → add learner → lesson → PDF downloads; second account's list is empty and the first's learner URL shows not found; picker and Transfer absent; expired account sees the banner and a create returns 402; `scrollWidth <= 375` on every page. Full checks + `run.sh` → PASS.
- [ ] **Step 5:** Commit `feat(saas): welcome, account, trial banner, saas qa`; update `STATUS.md`/`TASK.md`; push `feature/saas-p1-mode`; L2 review; PR to `staging`. No SaaS deployment.

## P2 — Provisioning (needs Tony)

### Task 6: Deploy the SaaS environment

- [ ] **Step 1 (Tony):** separate Zero Trust team or `actgds` team; Access app on the SaaS hostname (One-time PIN, include Everyone, session ~30 days); confirm the private apps' policies are e-mail-only; check the user limit.
- [ ] **Step 2 (agent, after Tony's go):** `wrangler d1 create instructor-assistant-db-saas`; add `[env.saas]` (Worker `instructor-assistant-saas`, `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `APP_MODE = "saas"`, `SAAS_TRIAL_DAYS = "30"`, `ACTGDS_INTEGRATION_ENABLED = "false"`, self-reference service, D1 with `migrations_dir = "migrations-saas"`, no Cron); `wrangler d1 migrations apply DB --remote --env saas`; deploy with `--env saas`.
- [ ] **Step 3:** verify: unauthenticated request → Access login; `/api/me` → `mode: "saas"` and `onboarding_required` for a new e-mail; instructor count 0 before the first sign-up; private Staging/Production Worker versions unchanged.
- [ ] **Step 4:** update `STATUS.md` / `TASK.md`; Tony's smoke test = real One-time PIN login and sign-up on a real iPhone.
