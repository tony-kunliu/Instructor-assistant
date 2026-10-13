# Operating Handbook v2 — ACT Golden Driving School (IA + Website)

_**APPROVED by Tony 2026-10-12** ("批准手册"); his decisions on the ten open items are recorded in §14.
Applies to `tony-kunliu/Instructor-assistant` (IA, agent: Claude) and `tony-kunliu/actgds.com` (Website,
agent: Codex, taking over from Work). Per-repo `AGENTS.md` stays the rule book for its repo; this handbook
is the shared layer above both. Items still marked "proposed" are the ones §14 defers to follow-up work.
Facts marked **verified** were read from the repos/Issue #3 on 2026-10-12; facts marked **assumed** were
not. Changing §3/§4 or §14 needs Tony's explicit decision (§4.14)._

## 0. 给 Tony 的中文摘要

- 目的：让任何新的 agent 会话（Codex 接手网站，或新的 Claude 会话）第一天就能安全、独立地工作；Tony 只做决定和真机检查。
- 原则：快速迭代 + 安全开发；凡涉及法定记录（CBT&A、签名、PDF）质量优先于速度；提醒不阻塞；不允许"假通过"；Production 数据永不删除、永不改写。
- 分工：一个仓库一个负责人（IA = Claude，网站 = Codex），Tony 决策。每次合并前必须有**独立评审**：另一个会话、最强可用模型、看不到作者的对话，只拿 PR 链接和
  SHA，结论公开贴出并写明 SHA。
- 自主权限：IA 已有 §14（合并 staging / 迁移 Staging D1 / 合并 main / 通过 GitHub Actions 发布 Production）。网站目前**没有**可验证的
  Production 发布机制，PR #46 的自主发布处于 INACTIVE；网站可自主做到 feature → staging → QA Site，之后仍需 Tony。
- 必须问 Tony 的事（§4）：花钱、安全、隐私三大类，并展开成 18 项清单（新基础设施/订阅、密钥、DNS/发件人、真实邮件/定时任务、V1 合约或新的跨仓库端点/密钥、新的个人数据流出、第三方/AI
  处理学员数据、身份证件图片、Production 破坏性数据操作、权限/Access、重写表的迁移、法律/隐私文案、删除护栏、改本手册的授权清单、影响真实学员预约/付款……）。
- 风险分级 L1/L2/L3（与网站草案一致）：作者和评审**各自独立**定级，取高者。
- 交付流程：分支 → 独立评审 → staging → 发布 PR → 发布工作流；迁移先 Staging D1，Production 先记 Time Travel 恢复点；两仓库差异写明。
- 记忆文件改法（§9）：每个任务只写 `docs/tasks/<branch>.md`，`STATUS.md` 只在合并/发布那一步改，`TASK.md` 变成两行指针 —— 解决几乎每次合并都冲突的问题。
- Tony 2026-10-12 已批准本手册；10 项决定记录在 §14：网站发布"尽量自动"（Codex 先做只读 Sites 能力审计并提出发布机制，花钱/安全仍由 Tony 定）；IA §9 改为"agent 自选模型、代码和评审用最强模型"；采用 docs/tasks 记忆方案（后续任务实施）；跨模型互评（Codex 评 IA、Claude 评网站，L2/L3 默认）；§14 新增"新端点/新密钥必须问 Tony"；STOP/冻结 评论即熔断；分支永不删除；通知调用方按 IA-Cron 方案仅做 QA；网站 staging→main 自主仅限 L1/L2。

## 1. Mission and principles

1. Fast iteration with safe development. One bounded task at a time, finished end to end (design → build →
   test → independent review → staging → report) without asking at each step.
2. Quality over speed for anything touching the legal record: CBT&A events, Review/Final Drive validity,
   signatures, PDF content, learner identity, cumulative hours/km. A day's delay is cheaper than a wrong
   certificate.
3. Reminders never blockers: assessment rules (36 h gates, C23 eligibility, route check, licence validity)
   warn; they never stop a save. The only hard server rules are chronology/prerequisite checks already in
   place.
4. No false passes: "PASS" means the command ran now, on this SHA, and the output was read. Skipped, reused
   or unobservable checks are named as such (PARTIAL/BLOCKED), never rounded up.
5. Production data is never deleted or rewritten. Corrections go through History Edit / revisions; legacy
   anomalies are tolerated and derived around, not patched in SQL.
6. Two systems, two databases, forever (IA `AGENTS.md` §10; Website "Ecosystem boundaries"). No
   auto-matching of people; cross-repo payloads carry the minimum.
7. The GitHub remote is the only truth. Chat memory, local checkouts and old docs lose to `git fetch`.

## 2. Roles and ownership

| Who | Owns | Does not do |
|---|---|---|
| Tony (ADI) | Decisions, §4 approvals, secrets, real-device/real-login checks, final word on rules | Re-run tests, re-walk flows that tests cover |
| IA agent (Claude) | `Instructor-assistant` code, D1, workflows, IA half of Issue #3 | Edit the Website repo (read-only clone allowed) |
| Website agent (Codex; Work before 2026-10-12) | `actgds.com` code, Sites QA/Production, Website half of Issue #3 | Edit the IA repo |
| Independent reviewer | Verdict on a PR before merge (both repos) | Fix the code it reviews |

One repo, one owner. A cross-repo change is two PRs, one per owner, coordinated on Issue #3 (§8).

**Independent reviewer rule (approved for both repos, §14.5; closes Website PR #46 finding H3):** a different agent
session, the strongest model available, with no access to the author's conversation or working tree. Input:
the PR URL and the candidate SHA only; the author may not pre-classify the tier or summarise the diff for
the reviewer. Stance: adversarial (hunt defects, §7). Output: a visible GitHub PR review (Approve / Request
changes) that cites the reviewed SHA and the independently derived tier. A re-review is required after any
non-trivial fix; "fixed as suggested" is a claim, not evidence.

**Review proportionality (IA, decided by Tony 2026-10-13, §14.11; same quality bar, less repeated cost):**
- **L1:** no independent review required (author checks + CI).
- **L2, presentation only** (CSS, layout, markup, wording; no change to data, rules, queries, API shape,
  payloads, permissions or ownership): **one** independent review round. If it finds only Minor items, the
  author fixes them with a test or QA check per item, and the merging agent verifies the fix diff against the
  review list; no second reviewer.
- **L2 that adds or changes a derived value, query, API shape or D1 usage:** one independent review, plus a
  re-review of the fix commit when any Major/Critical finding or any non-trivial fix is involved.
- **L3, the ALWAYS-ASK list (§4) and anything touching CBT&A events, validity rules, signatures, PDF legal
  content, identity/ownership/transfer, middleware, workflows or `AGENTS.md`:** unchanged — full independent
  review (cross-model by default) and a re-review after any non-trivial fix.
- Any Blocker/Critical/Major finding on any tier, a review that cannot settle the tier, or a doubt about
  tier means the stricter row applies. Minor-only fixes never need a re-review; the merging agent states in
  its report which rule it applied. This section does not change Website rules; the Website adopts its own.

## 3. Standing authorizations (what agents may do alone)

**IA (in force, `AGENTS.md` §14, verified):**
1. Merge `feature/*` → `staging` and apply Staging D1 migrations (`Staging D1 Migrate` workflow, on `main`)
   once typecheck, `npm test`, build, `qa-browser` (UI changes), Memory Guard and independent review pass.
2. Post informational/coordination messages on Issue #3.
3. Merge `staging` → `main` once Staging runs the intended commit with green post-merge CI.
4. Release `main` to Production via the `Production Release` workflow (Time Travel restore point + rollback
   target recorded, stop on first failure, never delete/rewrite data), including additive D1 migrations.
5. Read-only Production/Staging reports via `D1 Size Report` and `Progress Audit Export` workflows
   (aggregate / non-personal fields only).
Prerequisites for all: the task was assigned by Tony; no §4 item is touched; report afterwards; stop after
the task (§11).

**Website (verified from `AGENTS.md` on `main` and PR #46 head `aa4da3e8`):**
- In force today: feature → `staging` and QA Site delivery for the authorised task; Issue #3 posts.
  `staging` → `main` and any Production action need Tony's explicit authorisation per release (README,
  `docs/DEPLOYMENT.md`, `AGENTS.md` on `main`).
- Proposed by PR #46 (unmerged, INACTIVE): L1/L2 autonomous releases once an enforceable release gate
  exists. Blockers verified by the Website agent: `main`/`staging` unprotected (private repo, rulesets 403);
  no Production release workflow (only `ci.yml`, `playwright-qa.yml`, `production-readonly-smoke.yml`; CI
  has no `workflow_dispatch`); Production deploys via native Sites save/deploy, not GitHub; no
  least-privilege deploy identity verified.
- **Assumed, not verified by IA:** whether the Sites platform exposes any API/CLI a GitHub Actions runner
  could call. Until the Website agent completes its read-only capability audit, treat "Website Production
  release" as Tony-operated.

## 4. ALWAYS ASK TONY

Tony's three categories: **anything that costs money, anything about security, anything about privacy.**
Expanded (both repos; "ask" = stop, write the question in the report, wait):

| # | Item | Why |
|---|---|---|
| 1 | New infrastructure, services, subscriptions, plan upgrades (incl. GitHub plan for branch protection, a third Worker, a mail provider) | Money; new attack surface; Tony maintains it |
| 2 | Secrets and API keys of any kind | Tony sets them in the dashboard himself, never via chat/PR/log |
| 3 | DNS, domains, email sender identity (SPF/DKIM), Cloudflare Access policies | Outage or spoofing risk; irreversible from a phone |
| 4 | Enabling real email/SMS/notifications or any scheduler/Cron in Production | Real students receive it; cannot be unsent |
| 5 | Changing the V1 contract (schema, semantics, transport) or adding any cross-repo endpoint, transport or shared secret (e.g. the notify-tick) | Lockstep change across two repos; closes PR #46 M3 and the IA §14 gap |
| 6 | Any personal-data field leaving its system or shown to a new audience (allowlist growth, new Admin/My Driving column) | Privacy; the allowlist is the boundary |
| 7 | Third-party processors or AI services receiving learner data or images | Privacy; data leaves Australia/our control |
| 8 | Storing identity-document images (licence scans) rather than parsing locally and discarding | Highest-sensitivity data class |
| 9 | Destructive data operations, backfills, replays, rewrites in Production | Violates principle 5; audit history |
| 10 | Auth, Cloudflare Access, roles, permissions, Admin allowlists (incl. "temporary") | Security |
| 11 | Production migrations that rewrite/rebuild existing tables (additive IA migrations are covered by §14.4; Website migrations are all L3 until delegated) | Data loss is silent and permanent |
| 12 | Legal/consent/privacy/terms/unsubscribe/pricing wording, email templates | Legal exposure; L1 "copy" does not cover these (PR #46 M1) |
| 13 | Removing or weakening guardrails, CI checks, Memory Guard, workflow confirmations, kill switches | Defence in depth is only as good as its weakest edit |
| 14 | Changing §3/§4 of this handbook or any `AGENTS.md` authorization section | Policy is L3 by definition (PR #46 M5) |
| 15 | Anything affecting real students' bookings, payments, Cal.com, Golden Account | Money and trust |
| 16 | Making a private repo public, or granting repo access to a new account/app | Security; irreversible exposure of history |
| 17 | Deleting branches, tags, releases, artifacts, evidence files | `AGENTS.md` §5; evidence is the audit trail |
| 18 | Any action whose tier is unclear | "If in doubt, L3" (PR #46) |

Phone-executable freeze (in force, §14.7): a comment by Tony containing `STOP` / `冻结` on Issue #3 suspends
every standing authorization in both repos until he lifts it. Agents check the last comments before any
merge or release.

## 5. Risk tiers

Aligned with Website `docs/AUTONOMOUS_DELIVERY_V1.md` (PR #46); IA adopts the same names.

- **L1 routine:** visual spacing/layout, non-legal copy, accessibility, ordinary docs (not policy/release
  docs), test-only changes. Autonomous end to end where §3 allows.
- **L2 controlled, non-mutating or additive:** read-only projections, progress wording/provenance, reminder
  logic (`lib/rules.ts`), new derived fields, additive IA migrations, new qa-browser sections. Requires
  independent review, ownership/privacy regression, D1-limit check, and (IA) `qa-browser` at phone and iPad
  widths.
- **L3 approval required:** everything in §4, plus writes to CBT&A events/validity rules, signature storage,
  PDF legal content, identity/ownership/transfer logic, `middleware.ts`, workflows, `AGENTS.md`.

Rules: tier is derived from the **semantic diff**, not file names or the author's claim; shared `lib/`
helpers, lockfiles, worker routes and CI can be L2/L3 behind a "UI-only" PR. Author and reviewer derive the
tier **independently**; the higher wins and the PR records both. A default-OFF flag does not lower the tier
of the code behind it. Critical/High review findings block until fixed and re-reviewed.

## 6. Delivery flow

```
feature/<name> → tests + qa-browser → independent review (cites SHA) → merge to staging
   → (IA) Staging D1 Migrate BEFORE the merge if migrations/ changed → post-merge CI green
   → Staging/QA Site runs the intended commit → release PR staging→main → post-merge main CI
   → (IA) Production Release workflow / (Website) Tony-operated Sites deploy → post-deploy checks → report
```

- **Migrations (IA):** additive only without §4.11 approval; `0NNN_*.sql` numbered, idempotent where SQLite
  allows; applied to Staging D1 by `Staging D1 Migrate` with `ref` = the feature branch **before** merging
  code that needs it (Workers Builds deploys every `staging` push); applied to Production by `Production
  Release` after it records the Time Travel bookmark. Compare-and-swap: a release is for one `main` SHA; if
  `main` moved, start over.
- **Rollback (IA):** `wrangler rollback` to the version printed in the release summary; D1 via `wrangler d1
  time-travel restore --bookmark=<bookmark>` only on Tony's decision (it rewinds data: §4.9). Code rollback
  never reverts a migration.
- **Post-deploy checks (IA):** anonymous GET returns 302/401/403 (the workflow asserts this); `D1 Size
  Report`; one real-login smoke by Tony/Anna only where automation cannot act (Access identity, touch
  signature).
- **Website differences, stated plainly (verified):** no release workflow; `npm test` runs the build first;
  Production is a Sites application (`appgprj_…`) deployed by native save/deploy with an archive-backed
  rollback version; QA is a separate Site with its own DB; branch protection cannot be enforced on the
  current plan; PR #46 excludes **all** Production migrations from autonomy, while IA §14.4 allows additive
  ones under a bookmark. Both are acceptable; they are different and must stay documented as such.
- Never: direct pushes to `staging`/`main`; force-push to shared branches; merging with red or unknown CI;
  "temporary" config changes without a restore step in the same task.

## 7. Review standards

Reviewers hunt for, in order:
1. **False passes** — tests that assert nothing, mocks that bypass the rule, QA checks that pass on an empty
   page, "skipped" counted as passed, evidence reused from another SHA.
2. **Data overwrite** — any UPDATE/PATCH that can write a field the user did not edit; derived values typed
   by hand; a save path that silently falls back (e.g. dropping an oversized signature).
3. **Ownership / privacy** — owner checks on every mutating route (CoP 9.2), transfer/archive races, fields
   added to a payload or page beyond the allowlist, logs containing names.
4. **D1 / Free-plan limits** — ≤ 50 queries per Worker invocation, ≤ 100 bound parameters per statement, ≤ 2
   MB per row (two 700 k signatures ≈ 1.4 MB); counted for the worst case (History Edit with downstream
   events), not the happy path.
5. **Time zone** — Canberra (`Australia/Sydney`) for every displayed date and every "today/weekday/hour"
   rule; UTC ISO in storage and contracts; never `iso.slice(0, 10)` for display (IA §15).
6. **Contract hash** — `jq -cS . docs/integrations/lesson-upserted-v1.schema.json | sha256sum` =
   `c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6`; `tests/integration-alignment.test.ts`
   must still pass; no payload field added "for convenience".
7. **Tests meaningful** — new behaviour and every QA finding gets a unit test and, for UI, a `qa-browser`
   check in the same change; the test must fail on the old code.
8. Phone first: 375–390 px, no horizontal scroll, 44 px targets; iPad widths for layout changes.

Real defects caught by review this week (why this list exists): (a) the first progress-validity fix still
let a milestone be revived by flipping a result and flipping it back — found HIGH on re-review, closed in
`fd50ad4`/`fd6f96e`; (b) iPad signature PNGs exceeded the 700 k server limit and the client fell back
silently — fixed canvas 640×320 and an explicit "too large" error (`b4b6afd`); (c) R10a's route line would
have overwritten the lesson's location text on every Competency 23 tick — now transition-only, no write on
tick (`8d1a441`); (d) address parsing matched street names as suburbs — hardened suburb matching
(`8d1a441`).

## 8. Cross-repo coordination

- Channel: `tony-kunliu/actgds.com` Issue #3 only (verified live record). Never DM via other repos' PRs.
- Message format (both sides already use it): `FROM:` agent/repo · `REPO / COMMIT:` · `CONTRACT VERSION /
  SHA256:` · `STATUS:` PASS/PARTIAL/BLOCKED/PROPOSAL · body · `NEXT HANDSHAKE:` · `TONY ACTION:`. Chinese
  for Tony-facing lines is fine; identifiers stay English. ≤ 25 lines; evidence as links/run ids.
- Contract ACK: a change flows Website → IA; IA's copy must be byte-identical (hash above) and the ACK names
  the exact commit and hash. An ACK never authorises deployment, secrets, migration or enablement.
- Needs Tony (both repos, per §4): any contract change; any new endpoint/transport/secret (e.g. notification
  dispatch caller — design agreed on Issue #3 as "reuse `POST /api/internal/lesson-notifications/dispatch`,
  cron-only, new HMAC key"; **implementation not authorised**); enabling notifications anywhere but QA.
- Informational posts (release done, defect fixed, design proposal) are under standing authority in IA §14.2
  and Website item 2.
- Do not duplicate QA across repos: IA tests the Sender, the Website tests the Receiver; the fixtures file
  is the shared truth.

## 9. Memory and handoff files (proposed scheme)

Problem (verified this week): `STATUS.md`, `TASK.md` and `docs/BACKLOG.md` are edited on nearly every
feature branch and conflict on nearly every merge; `TASK.md` describes one task while four branches are in
flight; `STATUS.md` carries branch-level detail that goes stale in hours.

Proposal (IA first; Website may adopt the same shape):
1. **Per-task file:** each branch writes `docs/tasks/<branch-name-with-slashes-as-dashes>.md` (≤ 2 KB): Goal
   · Done · Next · Blockers · Evidence (run ids, SHAs) · Tony action. Only that branch touches that file →
   no conflicts. On release the file moves to `docs/tasks/done/` (or is deleted; git keeps history).
2. **`STATUS.md`** describes environments only (Production/Staging versions, migration level, Integration
   state, known issues) and is edited **only** by the release/merge step (`staging`→`main` PR or the release
   PR), never on feature branches.
3. **`TASK.md`** becomes a two-line pointer: the currently authorised task's `docs/tasks/` file and the next
   recommended task. Branch-specific detail lives in the task file.
4. **`docs/BACKLOG.md`** is edited only in `docs/*` branches or at release; feature branches add backlog
   notes to their task file under "Follow-ups", folded in at release.
5. **Memory Guard changes needed:** (a) also lint `docs/tasks/*.md` (size ≤ 2 KB, no stale phrases); (b)
   require `TASK.md` to reference an existing `docs/tasks/` file; (c) retire the Integration token list in
   `check-project-memory.mjs` — two of its regexes now match by accident (`integration enabled[^\n]*no`
   matches "non-Production"; the "0005 not applied" sentence is history) — replace with "STATUS.md names
   Production migration level and Worker version"; (d) keep the 10 KB / 4 KB limits.
6. **Branch naming:** one branch per feature, never a single reusable "designated branch" (the
   `claude/continue-deployment-*` pattern was merged twice as PR #59 and #61 — fine, but it hides what
   changed). Force-push only on your own unmerged branch; never on `staging`/`main` or another agent's
   branch. Never delete branches (`AGENTS.md` §5, §4.17; Tony kept this unchanged, §14.8).

## 10. Engineering hygiene

- **QA ports / tmp:** `scripts/qa-browser/run.sh` uses `QA_PORT` (default 3100) and `mktemp -d`; parallel
  sessions must set distinct `QA_PORT` and `QA_OUT`. `tests/pdf-export-font-subset.test.ts` leaves a ~14 MB
  `/tmp/font-subset-*/out.pdf` per run (filled a shared disk on 2026-10-11); fix: remove the dir in
  `finally`, and until then run `rm -rf /tmp/font-subset-* /tmp/qa-paper-* /tmp/qa-prior-*` before long
  sessions.
- **Worktrees:** one worktree per branch (`git worktree add ../ia-<short> <branch>`); never work in the main
  checkout; never bare `git stash` (shared stack); temporary WIP commits instead.
- **Node:** local is 22.22, CI and Production Release pin 22.13 (`engines >=22.13`). Flags that changed
  between them bite (`--experimental-strip-types` was needed by the audit CLI test, `6910a4e`). Simulate the
  Workers Builds command (`CI=1`, no `pdftotext`) before merging to `staging`.
- **Models (approved, §14.3; now IA `AGENTS.md` §9):** the agent chooses its own models, aiming for top
  quality: the strongest available model for code, migrations, reviews and anything in §4/§5 L2+; a lighter
  model only for mechanical steps (fixture regeneration, lint fixes, doc index updates). Token/time budget
  is not a concern; quality and not having to redo work is.
- **Secrets:** never in git, logs, PR bodies, Issue #3 or chat; `wrangler.toml` holds non-secret config
  only; account ids are identifiers, not credentials.
- **Synthetic data only:** QA learners are named `QA …`; no real learner in Staging/QA; Production never
  gets a fake learner or fake event.

## 11. Communication format

Report to Tony in Chinese (code and identifiers in English), ≤ 15 lines:

```
Result: PASS | PARTIAL | BLOCKED
What: <one line>
Evidence: PR/commit SHA, CI run id, QA numbers (e.g. tests 548, qa-browser 293/293), deploy/Worker version
Not verified: <what and why, or "nothing">
Next step (下一步建议): <one line>
Tony must do: NONE | <one minimal check or decision>
```

No progress narration between steps; no asking a question that the repo can answer; no checklists for Tony
beyond the real-device/real-login items.

## 12. Resilience (sessions drop)

- Commit small and often on the feature branch; push after each green step; a dropped session resumes from
  the remote alone.
- Update the task file (§9.1) after every milestone: Done / Next / Blockers / Evidence.
- Before resuming: `git fetch`, compare branch to `origin/*`, read `AGENTS.md`, `STATUS.md`, `TASK.md`, the
  task file, and the last 5 Issue #3 comments.
- Never two writers on one branch; if another session is active on it, stop and report.
- Never leave results only in chat: evidence goes in the PR, the task file or Issue #3.

## 13. Checklists

**Release (IA):** [ ] `main` SHA = reviewed SHA = Staging-verified SHA · [ ] post-merge `main` CI green · [
] STATUS.md updated in the release PR (migration level, pending Worker) · [ ] no §4 item in the diff · [ ]
run `Production Release` with `confirm=production` · [ ] read the step summary: restore point, rollback
version, migrations applied, anonymous GET code · [ ] report with Worker version and run id · [ ] STATUS.md:
Worker version, migration level.

**Migration (IA):** [ ] additive only (or Tony approved §4.11) · [ ] numbered after the current level on
Staging **and** Production · [ ] worst-case query/param count within limits · [ ] `Staging D1 Migrate` with
`ref` = feature branch **before** merge · [ ] summary shows "No migrations to apply", `foreign_key_check`
empty, counts unchanged · [ ] rollback note: code rollback does not undo the migration; confirm old code
tolerates the new schema.

**New-agent onboarding (either repo):** [ ] `git fetch`; read `AGENTS.md`, `STATUS.md`, `TASK.md`,
`docs/INDEX.md`, this handbook · [ ] read the last 10 Issue #3 comments · [ ] run the test suite once
locally and note counts · [ ] confirm which standing authorizations are ACTIVE for your repo (§3) · [ ]
confirm there is no `STOP`/冻结 on Issue #3 · [ ] create your worktree and task file · [ ] first report to
Tony: what you found, what you will do, what you will not touch.

**Incident / rollback:** [ ] stop all further steps · [ ] record what is observed (run id, error, Worker
version) · [ ] code: `wrangler rollback` to the recorded version (IA) / Tony redeploys the saved version
(Website) · [ ] data: do nothing without Tony (Time Travel rewinds everything) · [ ] disable the Outbox/Cron
only if it is actively sending bad events (Tony decision) · [ ] post BLOCKED on Issue #3 if the other repo
is affected · [ ] report ≤ 15 lines with the exact rollback evidence.

## 14. Tony's decisions (2026-10-12)

1. **Handbook approved** as the shared layer, with the AGENTS.md pointers (§4 items 5, 14, 16, 17 and the
   freeze rule are now in force).
2. **Website Production releases: as automatic as safely possible.** Codex does the read-only Sites
   capability audit and proposes the release path (a verified release runner/mechanism, with the repository
   -variable kill switch from item 7, compare-and-swap on the `main` SHA, rollback target and post-deploy
   smoke). Anything that costs money (e.g. a GitHub plan for branch protection) or changes security stays
   Tony's decision per proposal. Until the mechanism is verified, Website Production remains Tony-operated.
3. **IA `AGENTS.md` §9 replaced** (done in this commit): the agent chooses models itself, aiming for top
   quality — strongest model for code, migrations and review; lightweight only for mechanical steps; token
   budget is not a concern.
4. **`docs/tasks/` memory scheme adopted** (§9). Implementation is a follow-up task (Memory Guard changes,
   first task files); until it lands, keep editing the current files as today.
5. **Independent-reviewer definition accepted for both repos** (§2). Cross-model review is the default for
   L2/L3: Codex reviews IA PRs, Claude reviews Website PRs; each reads the other repo read-only and never
   commits to it. L1 may use any independent session.
6. **New endpoint/transport/secret wording added to IA `AGENTS.md` §14** (done in this commit); the
   Website adds the same to PR #46 (finding M3) and records the migration-policy difference in
   `AUTONOMOUS_DELIVERY_V1.md`.
7. **Kill switch now = the `STOP`/冻结 comment on Issue #3** (§4). The repository-variable kill switch is
   part of the Website release-path work (item 2); IA adds the same variable check to its workflows when
   the Website's design is agreed, so both repos read one convention.
8. **Branches are never deleted** — unchanged (`AGENTS.md` §5).
9. **Notification caller: IA-Cron transport-only design agreed in principle.** QA-only build (flag default
   OFF, IA Staging Cron → Website QA Site) after the Website agent confirms the endpoint spec on Issue #3;
   the new HMAC key is set by Tony in both dashboards; Production stays OFF until a separate decision.
10. **Website `staging`→`main` autonomy limited to L1/L2** with independent tier derivation; PR #46 must
    first apply the H1 fix (tier limit on items 1 and 3; L3 never merges to `main` without Tony).
11. **IA review proportionality (2026-10-13):** keep the strict independent review for L3, the ALWAYS-ASK
    list and anything that adds or changes data, rules, queries or API shape; for presentation-only L2 use one
    review round and no re-review when only Minor items remain (§2 "Review proportionality"). Tony's reason:
    same quality where it matters, fewer repeated review rounds.

Follow-up tasks created by these decisions: (a) Codex: PR #46 H1–H5/M1–M5 fixes incl. M3 wording, then
the read-only Sites release capability audit; (b) Claude: `docs/tasks/` scheme + Memory Guard changes;
(c) both: cross-model review on the next L2/L3 PR; (d) Claude: IA-side notify caller spec once the Website
confirms the endpoint. Each is a separate task with its own go from Tony (`AGENTS.md` §11).
