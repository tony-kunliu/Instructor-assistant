# SaaS Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a separately deployed, self-serve SaaS edition (Access One-time PIN login, per-instructor isolation, 30-day trial) without changing the private Tony/Anna version's behaviour or Production D1.

**Architecture:** One codebase, `APP_MODE` (`private` default, `saas`). Isolation is enforced at the API boundary: list queries take a `Scope`, and every route keyed by a learner id calls `requireLearnerInScope` first (all lesson/revision/PDF/export/import routes are nested under a learner id, and `getLesson` already pairs `lesson_id` with `learner_id`). SaaS-only decisions (onboarding, trial) live in a pure `lib/saas/gate.ts` that `middleware.ts` applies.

**Tech Stack:** Next.js 16 on Cloudflare Workers (OpenNext), D1 (local: `node:sqlite` via `openTestD1`), `node:test`, Playwright qa-browser.

**Spec:** `docs/superpowers/specs/2026-10-21-saas-edition-design.md` (§5 updated by Task 3 to describe the API-boundary guard used here).

## Global Constraints

- Private mode (`APP_MODE` unset or anything but `"saas"`) must behave exactly as today; the whole existing `npm test` suite and `bash scripts/qa-browser/run.sh` pass unchanged.
- No new migration in `migrations/`; the private D1 databases get nothing.
- Out-of-scope learner/lesson → `404` (`NotFoundError`), never `403`.
- Scope comes only from middleware's trusted headers; client-supplied `x-instructor-id`, `x-instructor-name`, `x-access-email` are overwritten or removed by middleware.
- Trial: writes allowed while `now < createdAt + SAAS_TRIAL_DAYS × 24h` (default 30); afterwards non-GET `/api/*` → `402 {"error":"trial_expired"}`; GET (reads, PDF, export) always allowed.
- Onboarding: pages → redirect `/welcome`; API → `403 {"error":"onboarding_required"}`.
- iPhone first: every new screen works at 375 px with no horizontal scroll. Dates shown in Canberra time via `canberraDateTime()`.
- `npm run typecheck`, `npm test`, `npm run build`, Memory Guard, qa-browser must pass before each commit that touches code (AGENTS.md §8).
- P0 = Tasks 1-3 (one PR, tier L3, independent review, Production release only with Tony's separate go). P1 = Tasks 4-6 (one PR, L2). P2 = Task 7 (needs Tony).

## Review Focus

- E-mail case: `Coach@Example.com` and `coach@example.com` are the same account (Task 5 test).
- A client sending its own `x-instructor-id` / `x-access-email` header in saas mode gets no other identity (Task 5 test).
- Own learner id + another tenant's lesson id → 404 on GET/PATCH lesson and revisions (Task 2 test).
- Archived list (`?archived=1`) and summaries are scoped too (Task 2 test).
- Double-tapped `/welcome` submit creates one instructor, the second call returns the same one (Task 5 test).

---

## P0 — Isolation (no behaviour change in private mode)

### Task 1: App mode and Scope

**Files:**
- Create: `lib/app-mode.ts`, `lib/scope.ts`
- Test: `tests/scope.test.ts`

**Interfaces:**
- Produces: `type AppMode = "private" | "saas"`; `parseAppMode(raw: unknown): AppMode`; `currentAppMode(): AppMode` (reads `getCloudflareContext().env.APP_MODE`, falls back to `process.env.APP_MODE`, `private` on any error); `type Scope = { kind: "all" } | { kind: "instructor"; instructorId: string }`; `scopeFor(mode: AppMode, instructorId: string | null): Scope`; `requestScope(request: Request): Scope`.

- [ ] **Step 1: Write failing tests** in `tests/scope.test.ts`:
  - `parseAppMode("saas") === "saas"`; `parseAppMode(undefined)`, `parseAppMode("SAAS ")`, `parseAppMode("prod")` all `"private"`.
  - `scopeFor("private", null)` and `scopeFor("private", "i1")` deep-equal `{ kind: "all" }`.
  - `scopeFor("saas", "i1")` deep-equals `{ kind: "instructor", instructorId: "i1" }`.
  - `scopeFor("saas", null)` and `scopeFor("saas", "")` throw (fail closed, never `all`).
- [ ] **Step 2:** `npm test` → the new tests FAIL (module missing).
- [ ] **Step 3:** Implement both files. `requestScope` = `scopeFor(currentAppMode(), request.headers.get("x-instructor-id"))`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(saas): app mode and request scope`.

### Task 2: Scoped lists and the learner guard

**Files:**
- Modify: `lib/repo.ts` (`listLearners` ~295, `learnerSummariesSql` ~302, `listLearnerSummaries` ~331, `listActiveInstructors` ~214; add `requireLearnerInScope`)
- Test: `tests/tenant-scope.test.ts`

**Interfaces:**
- Consumes: `Scope` (Task 1).
- Produces: `listLearners(db, { archived?, scope? })`, `listLearnerSummaries(db, { archived?, scope? })`, `listActiveInstructors(db, scope?)` — `scope` defaults to `{ kind: "all" }`; `requireLearnerInScope(db: D1Database, scope: Scope, learnerId: string): Promise<void>` throwing `NotFoundError("Learner not found.")`.

- [ ] **Step 1: Write failing tests** with `openTestD1()`, two synthetic instructors `QA Coach A` / `QA Coach B`, one learner each (plus one archived learner each), one lesson each:
  - `listLearners(db, { scope: A })` returns only A's active learner; with `archived: true` only A's archived one; without scope returns all (private unchanged).
  - `listLearnerSummaries` keys for scope A ⊆ A's learner ids.
  - `requireLearnerInScope(db, A, bLearnerId)` rejects with `NotFoundError`; with A's id resolves; with `{ kind: "all" }` and B's id resolves; with an unknown id rejects `NotFoundError` in both scopes.
  - `getLesson(db, aLearnerId, bLessonId)` and `listLessonRevisions(db, aLearnerId, bLessonId)` → NotFound / `[]` (pins the existing pairing).
  - `listActiveInstructors(db, A)` returns exactly `[A]`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement: append `AND l.instructor_id = ?` (bound) when scope is `instructor`, in both the learner select and the summaries SQL; `requireLearnerInScope` = `SELECT 1 FROM learners WHERE id = ? [AND instructor_id = ?]`.
- [ ] **Step 4:** `npm test` (whole suite) → PASS; existing tests untouched.
- [ ] **Step 5:** Commit `feat(saas): scoped learner lists and requireLearnerInScope`.

### Task 3: Wire every route; close transfer and picker leaks

**Files:**
- Modify: every `app/api/learners/[id]/**/route.ts` (archive-history, export, import, lessons, lessons/[lessonId], lessons/[lessonId]/revisions, route.ts, transfer, transfer/checked), `app/api/learners/route.ts`, `app/api/instructors/route.ts`, `lib/api.ts`
- Modify: spec §5 text (guard at the API boundary instead of a `scope` on every repo function)
- Test: `tests/route-scope-guard.test.ts`, `tests/api.test.ts`

**Interfaces:**
- Consumes: `requestScope`, `requireLearnerInScope`, scoped lists.
- Produces: `readJsonForNewLearner(request: Request, scope: Scope): Promise<Record<string, unknown>>` in `lib/api.ts` (instructor scope: `instructorId` = scope id, body value ignored; `all`: today's `readJsonWithDefaultInstructor`).

- [ ] **Step 1: Write failing tests:**
  - `route-scope-guard.test.ts`: for every `route.ts` found under `app/api/learners/[id]`, each exported `GET|POST|PATCH|PUT|DELETE` handler's source contains `requireLearnerInScope(` before its first other `lib/repo.ts`/`lib/api.ts` data call; the transfer and transfer/checked handlers contain `assertPrivateMode(`.
  - `api.test.ts`: `readJsonForNewLearner(req({ instructorId: "other" }), { kind: "instructor", instructorId: "me" })` → `instructorId === "me"`; with `{ kind: "all" }` keeps `"other"`.
  - `api.test.ts`: `assertPrivateMode({ kind: "instructor", instructorId: "me" })` throws `NotFoundError`; with `all` returns.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** In each handler: `const scope = requestScope(request); await requireLearnerInScope(db, scope, id);` before the existing work (inside `handle`, sequential, before any `Promise.all`). List GET passes `scope`; POST learner uses `readJsonForNewLearner`; `/api/instructors` passes `scope`; transfer routes call `assertPrivateMode(scope)` (exported from `lib/api.ts`). Update spec §5 wording.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build && node scripts/check-project-memory.mjs && bash scripts/qa-browser/run.sh` → all PASS (private behaviour unchanged).
- [ ] **Step 5:** Commit `feat(saas): enforce learner scope on every learner route`; push `feature/saas-p0-isolation`; independent L3 review; PR to `staging`. **Stop before Production; ask Tony.**

## P1 — SaaS mode

### Task 4: SaaS migrations directory

**Files:**
- Create: `migrations-saas/0001_init.sql` … `0013_learner_other_licence.sql` (byte copies), `migrations-saas/9001_saas_instructor_names.sql`
- Test: `tests/saas-migrations.test.ts`

- [ ] **Step 1: Write failing tests:** every file in `migrations/` exists in `migrations-saas/` with identical bytes; the only extra files match `^9\d{3}_`; applying `SCHEMA_SQL` then `9001` to `openTestD1()` allows two instructors named `QA Same Name` with different e-mails and rejects a second `QA@x.test` vs `qa@x.test`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Copy files; `9001`: `DROP INDEX IF EXISTS instructors_name_idx; CREATE UNIQUE INDEX IF NOT EXISTS instructors_email_idx ON instructors (lower(email));`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(saas): saas migrations directory`.

### Task 5: Onboarding + trial gate and middleware

**Files:**
- Create: `lib/saas/accounts.ts`, `lib/saas/gate.ts`, `app/api/welcome/route.ts`
- Modify: `middleware.ts`, `app/api/me/route.ts`
- Test: `tests/saas-gate.test.ts`, `tests/saas-accounts.test.ts`

**Interfaces:**
- Produces:
  - `findSaasInstructor(db, email): Promise<{ id: string; fullName: string; createdAt: string } | null>` (case-insensitive, active only)
  - `createSaasInstructor(db, { email, fullName, adiNumber }): Promise<{ id; fullName; createdAt }>` — returns the existing row if the e-mail already exists (idempotent); `fullName` required (trimmed, ≤ 80), `adiNumber` required (trimmed, ≤ 20) else `ValidationError`
  - `trialEndsAt(createdAt: string, days: number): Date`
  - `saasGate(input: { email: string; instructor: {id; fullName; createdAt} | null; method: string; pathname: string; now: Date; trialDays: number }): { kind: "pass"; instructorId?: string; instructorName?: string } | { kind: "redirect"; to: "/welcome" } | { kind: "error"; status: 402 | 403; error: "trial_expired" | "onboarding_required" }`
  - `/api/me` adds `mode: AppMode` and, in saas, `trialEndsAt: string`.

- [ ] **Step 1: Write failing tests:**
  - gate: no instructor + `GET /` → redirect `/welcome`; no instructor + `GET /welcome`, `POST /api/welcome`, `GET /terms`, `GET /privacy` → pass without instructorId; no instructor + `GET /api/learners` → error 403 `onboarding_required`.
  - gate: instructor created `2026-01-01T00:00:00.000Z`, 30 days: `POST /api/learners` at `2026-01-30T23:59:59Z` → pass; at `2026-01-31T00:00:00Z` → 402 `trial_expired`; `GET /api/learners/x/export` at day 40 → pass.
  - accounts: create then find with `COACH@X.TEST` returns same id; second create with same e-mail returns same id and row count stays 1; empty name → `ValidationError`.
  - middleware helper `forwardHeaders(request, gateResult, email)`: client-supplied `x-instructor-id`, `x-instructor-name`, `x-access-email` are removed/replaced.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. Middleware: after verifying the Access JWT, if `currentAppMode() === "saas"` use `findSaasInstructor` + `saasGate` (trial days from `env.SAAS_TRIAL_DAYS`, default 30) and set `x-access-email` only for `/api/welcome`; otherwise today's private path untouched. `POST /api/welcome` reads `x-access-email` (never the body) and calls `createSaasInstructor`.
- [ ] **Step 4:** `npm run typecheck && npm test` → PASS.
- [ ] **Step 5:** Commit `feat(saas): onboarding and trial gate`.

### Task 6: SaaS pages, hiding, qa-browser

**Files:**
- Create: `app/welcome/page.tsx`, `app/account/page.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/api/account/export/route.ts`, `scripts/qa-browser/saas.mjs`
- Modify: `app/driver-app.tsx` (read `mode`/`trialEndsAt` from `/api/me`; in saas hide instructor picker, Transfer, `/gps` link; show trial banner; disable forms when expired), `app/gps/page.tsx` (`notFound()` in saas), `scripts/qa-browser/run.sh` (second pass in saas mode)
- Test: `tests/saas-pages.test.ts` (pure helpers), qa-browser `saas.mjs`

- [ ] **Step 1: Write failing tests:** pure `trialBanner(trialEndsAt, now)` → `"Free trial: 12 days left"` / `"Free trial ended — read-only. Your records and PDFs stay available."`; `GET /api/account/export` in scope A contains only A's learners.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement pages (existing styles, no redesign). `/terms` and `/privacy` start with a visible `DRAFT — not yet reviewed` line. `run.sh` saas pass: in the copy, set `APP_MODE = "saas"`, `migrations_dir = "migrations-saas"`, and a stub middleware that reads `x-qa-email` and calls the real `saasGate`.
- [ ] **Step 4:** `saas.mjs` at 375 px: new e-mail → `/welcome` → add learner → lesson → PDF downloads; second account cannot open the first account's learner URL (not found) and its list is empty; instructor picker and Transfer absent; expired-trial account sees banner and a create returns 402; `document.documentElement.scrollWidth <= 375` on each page. Run `npm run typecheck && npm test && npm run build && node scripts/check-project-memory.mjs && bash scripts/qa-browser/run.sh` → PASS.
- [ ] **Step 5:** Commit `feat(saas): welcome, account, trial banner, saas qa`; push `feature/saas-p1-mode`; L2 review; PR to `staging`. No saas deployment yet.

## P2 — Provisioning (needs Tony)

### Task 7: Deploy the SaaS environment

- [ ] **Step 1 (Tony):** create the Access Application for the SaaS hostname (One-time PIN, include Everyone), confirm the Zero Trust user limit, choose the hostname.
- [ ] **Step 2 (agent, after Tony's go):** create D1 `instructor-assistant-db-saas`; add `[env.saas]` to `wrangler.toml` (Worker `instructor-assistant-saas`, its `ACCESS_AUD`, `APP_MODE = "saas"`, `SAAS_TRIAL_DAYS = "30"`, `ACTGDS_INTEGRATION_ENABLED = "false"`, self-reference service, D1 with `migrations_dir = "migrations-saas"`, no Cron); apply migrations; deploy.
- [ ] **Step 3:** verify: unauthenticated request is redirected by Access; `/api/me` without an instructor → `onboarding_required`; private Staging/Production Worker versions unchanged.
- [ ] **Step 4:** update `STATUS.md` / `TASK.md`; Tony's smoke test = real One-time PIN login on a real iPhone.
