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

## Project rules (CBT&A Checklist)

- Do **not** invent an official CBT&A competency list. `Taught`,
  `Competencies Assessed` and `Achieved` remain free-text until the official
  ACT list is verified.
- iPhone first: every screen must work at 375px width with no horizontal
  scroll.
- Values that can be derived (duration, km, cumulative totals, lesson number)
  must be calculated, never typed by the instructor.
