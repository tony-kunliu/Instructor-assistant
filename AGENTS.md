# AGENTS.md — Working Rules for ACTGDS Driver / Instructor Assistant

These rules apply to every human or AI agent working in this repository
(`tony-kunliu/instructor-assistant`) — ChatGPT, Claude Code, or any other
agent. They exist so any agent that picks up this project follows the same
process, without re-deriving it each time.

## 1. GitHub remote is the single source of truth

The GitHub remote — its branches, commits, issues and this repo's root docs —
is the only trusted source for both code and project status. Never treat a
local checkout, chat history, or another document as authoritative if it
disagrees with GitHub.

## 2. Before starting any task

1. `git fetch` the remote.
2. Check the current branch and how it compares to the matching
   `origin/*` ref (ahead / behind / diverged).
3. Check for dirty / uncommitted work (`git status`) and resolve or stash it
   before starting.
4. Read `AGENTS.md` (this file), `STATUS.md` and `TASK.md` to confirm the
   current task and known state before writing anything.

## 3. Standard branch flow

```
feature/* → staging → main → Production
```

- **`feature/*`** — one independent feature or bug fix per branch. Nothing
  else.
- **`staging`** — integration and QA only. Feature branches land here first.
- **`main`** — the trusted, official source baseline. **Merging into `main`
  requires Tony's explicit authorization.**
- **Production** — requires a **separate, explicit authorization from Tony**.
  Merging to `main` does **not** imply permission to deploy to Production.

## 4. Task workflow

For every task, follow this sequence and stop at the end:

```
Clear task
→ actually working implementation
→ build / tests pass
→ commit
→ push to the feature/task branch (staging only after review)
→ focused QA (only what the task covers)
→ update STATUS.md / TASK.md
→ report to Tony
→ STOP
```

Do not chain into the next task automatically, even if an obvious next step
exists.

## 5. Not allowed, ever

- Scope creep — building more than the current task asks for.
- Unrelated cleanup or refactors that were not requested.
- Unrequested UI redesign.
- Unrequested "optimization" of working code.
- Hard-coding values or behavior just to make a test pass.
- Touching unrelated features while working on a task.
- Modifying Production without separate, explicit authorization.
- Merging into `staging` or `main` without authorization.
- Deleting branches or data without authorization.
- Committing secrets, tokens, credentials, API keys, or real customer /
  learner data.

## 6. When something else looks wrong

If an agent notices an unrelated bug, risk, or improvement opportunity while
working on the current task: **do not fix it automatically.** Record it as a
note in `STATUS.md` under "Known Issues" and continue with only the assigned
task.

## 7. Communication language

- Default chat communication with Tony is in **Chinese (中文)**.
- Code, variable names, API names, git commit messages, and technical
  terminology stay in **English** as usual — only switch to English there if
  Chinese would reduce coding accuracy or clarity.

## 8. Build / test discipline

`npm run build` and `npm test` must both pass before any code change is
committed. (Documentation-only changes don't require a build, but must still
be reviewed for accuracy against the current remote state.)

## 9. Claude Code model selection

- **Default: Claude Sonnet 5** for day-to-day work — feature development,
  bug fixes, UI, API, tests, build, documentation, ordinary refactors, Git
  operations, and staging QA.
- **Escalate to the latest available Claude Opus** (prefer **Claude Opus
  5.5** if the current environment offers it; otherwise the latest available
  Opus) only for:
  - complex architecture decisions
  - major database changes / migrations
  - hard-to-locate bugs
  - repeated failed fix attempts
  - changes that cross multiple subsystems
  - large-scale refactors
  - security review
  - important code review before Production
  - long-running autonomous coding sessions
- Do not default to Opus just because it is more capable. Once the escalated
  task is done, switch back to Sonnet 5 for ordinary work.

## Project rules (CBT&A Checklist)

- The official CBT&A competency list (1-22, Review 1-17, Review 1-22, 23
  Final Drive) has been verified — Tony provided the ACT government's own
  document (see `lib/competency.ts#competencyFullName`). `Taught`,
  `Competencies Assessed` and `Achieved` use this official numbering; the
  full official titles are display-only and never affect persisted/validated
  data.
- iPhone first: every screen must work at 375px width with no horizontal
  scroll.
- Values that can be derived (duration, km, cumulative totals, lesson number)
  must be calculated, never typed by the instructor.

## 10. Ecosystem boundaries (Instructor Assistant ↔ ACTGDS Website)

Two separate systems, two separate repos, two separate databases. Neither
reads or writes the other's database directly, and neither ever shares a D1
instance. This is permanent, not a phase-one shortcut.

- **ACTGDS Website** (`tony-kunliu/actgds.com`) is the **Customer / Student
  Identity source of truth**: student identity, name, phone, email, address,
  CRM, website account, Booking/Cal.com, student-facing presentation,
  notifications.
- **Instructor Assistant** (this repo) is the **Teaching / Lesson source of
  truth**: instructor lessons, CBT&A competencies, Review 1-17, Review 1-22,
  Final Drive 23, odometer, hours/km, signatures, PDF export, and future
  GPS/Driving Journey data.

Permanent integration principles:

- Never auto-match a learner/student across systems by name, phone, or
  email. The only cross-system identity link is an explicit, versioned
  `learner_id` a human (Tony) links by hand in the ACTGDS CRM.
- ACTGDS never re-implements the CBT&A engine; Instructor Assistant never
  manages customer contact details (that stays ACTGDS's job even for
  learners who also exist here).
- Any cross-system interface is versioned (a `contract_version` field,
  bumped on any breaking change) and changed in lockstep across both repos —
  never a silent, one-sided change.
- **ACTGDS's copy of a shared contract schema is the canonical authority.**
  This repo's copy under `docs/integrations/` must be byte-identical to
  ACTGDS's (verified via `jq -cS . <file> | sha256sum` producing the exact
  same hash both sides record) — never a "semantically equivalent" variant
  invented independently here. A contract change flows ACTGDS → this repo,
  confirmed with an ACK naming the exact commit/hash, never the reverse
  (established during ACTGDS Integration V1 Contract Alignment; see
  `tony-kunliu/actgds.com` Issue #3 for the live coordination record).
- A lesson save/edit in this app must never fail, block, or degrade because
  the website integration is down, slow, unconfigured, or misconfigured.
  Integration delivery is always best-effort and asynchronous relative to
  the user-visible save.
- Secrets (webhook signing keys, tokens) are never committed or logged.
- Cross-system payloads carry only what the other system actually needs for
  its own job — never more (see the specific integration contract doc for
  what's excluded).

See `docs/ECOSYSTEM_ROADMAP.md` for the longer-term shared direction and
`docs/integrations/` for the versioned contracts themselves.

## 11. End-of-task self-memory rules

At the end of every task, before reporting to Tony:

1. **Update `STATUS.md`** with the actual current state: branch/commit,
   deploy/DB state, known issues. Keep a "Current Snapshot" near the top so
   a future agent isn't misled by older history further down the file.
2. **Update `TASK.md`** to explicitly include:
   - `Current Task:` — Completed / Partial / Blocked
   - `Next Recommended Task:` — what to do next and why
   - `Waiting on Other Repo:` — what the ACTGDS side (or this side) needs to
     finish first, if anything
   - `Tony Manual Action Required:` — or `NONE` if there isn't one
3. The final report to Tony must proactively state a **"下一步建议" (next
   step recommendation)** — never leave him to guess what's next.
4. **Never** auto-start the next recommended task. Always stop and wait for
   Tony's explicit go-ahead, even when the next step seems obvious.

This exists so Tony never has to re-explain the project's direction from
scratch to whichever agent picks up the next task.
