# AGENTS.md — Working Rules for ACTGDS Driver

These rules apply to every human or AI agent working in this repository.

1. **Read remote state before every task.** `git fetch` and check the current
   state of `main`, `staging` and the relevant `feature/*` branch on GitHub.
   GitHub is the source of truth — never assume a local SHA is current.
2. **One explicit task at a time.** Work only on the task written in `TASK.md`
   (or given explicitly by the owner). Do not start the next task unasked.
3. **Build and test before commit.** `npm run build` and `npm test` must both
   pass before anything is committed.
4. **Branch flow: `feature/*` → `staging` → `main`.** Develop on a
   `feature/*` branch, merge into `staging` for verification, then into `main`.
5. **Production requires separate approval.** Merging to `main` or deploying to
   Production needs an explicit, separate approval from the owner.
6. **Do not expand scope.** Build only what the task asks for. Out-of-scope
   ideas go into `STATUS.md` as notes, not into code.
7. **Do not commit secrets.** No API keys, tokens, passwords, `.env` files or
   real learner databases. `data/` and `*.sqlite` are git-ignored.
8. **Stop after the requested task is complete.** Report the result, update
   `STATUS.md`, and stop.

## Project rules

- Do **not** invent an official CBT&A competency list. `Taught`,
  `Competencies Assessed` and `Achieved` remain free-text until the official
  ACT list is verified.
- iPhone first: every screen must work at 375px width with no horizontal scroll.
- Values that can be derived (duration, km, cumulative totals, lesson number)
  must be calculated, never typed by the instructor.
