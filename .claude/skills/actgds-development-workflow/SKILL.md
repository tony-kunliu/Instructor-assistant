---
name: actgds-development-workflow
description: Use when starting, resuming, debugging, reviewing, or integrating development work in ACT Golden Driving School repositories, especially from a fresh Work or Claude Code session or when deciding which Superpowers workflow applies.
---

# ACTGDS Development Workflow

## Overview

This is a thin workflow router, not a second copy of project rules. The repo's `AGENTS.md` is the project-specific authority. Rehydrate from GitHub first, invoke the right Superpowers skill, verify with fresh evidence, respect authorization gates, then stop.

## Start Every Development Task

1. `git fetch`.
2. Inspect current branch, dirty work, and remote divergence.
3. Read `README.md`, `AGENTS.md`, `STATUS.md`, and `TASK.md`.
4. Treat current GitHub remote state as truth. Do not rely on remembered SHAs, old chat state, or an agent's previous report.

## Route by Task Type

| Situation | Required workflow |
| --- | --- |
| New feature, behavior, architecture, or product decision | **REQUIRED SUB-SKILL:** Use `superpowers:brainstorming` |
| Approved multi-step requirements/spec | **REQUIRED SUB-SKILL:** Use `superpowers:writing-plans` before implementation |
| Existing approved implementation plan | Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` when available |
| Bug, failing test/build/CI, or unexpected behavior | **REQUIRED SUB-SKILL:** Use `superpowers:systematic-debugging`; use `superpowers:test-driven-development` for the fix |
| Two or more independent problem domains | Use `superpowers:dispatching-parallel-agents` when the harness supports it |
| Before claiming fixed, passing, ready, or complete | **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` |
| Implementation is green and needs integration | Use `superpowers:requesting-code-review` and `superpowers:finishing-a-development-branch` |
| Authorized real-browser QA | Use the repo's Playwright skill when available |

## Authorization and Scope

Follow `AGENTS.md` exactly. Never infer permission to merge, migrate, configure secrets, deploy, or touch Production from an earlier approval. A merge authorization is not a Production authorization. Cross-repo work changes only the repo explicitly authorized by the task unless Tony explicitly authorizes both.

Do the requested task first. Record unrelated issues; do not fix them.

## Completion Gate

Fresh evidence is mandatory. Run the repo's trusted checks and inspect the final diff.

If the authorized task includes a merge, completion means:

1. merge completed;
2. post-merge CI succeeded;
3. Project Memory Guard/current-state documentation check passed.

Update `STATUS.md` with current truth only and `TASK.md` with the current/next task. Do not persist ordinary moving staging HEAD SHAs unless `AGENTS.md` says they are durable references.

Report: actual status, branch/PR, verification evidence, environment changes, known issues, next recommended task, and any Tony action required. Then **STOP**.

## Quick Handoff

For a fresh session, a short task should normally be enough:

> Read the repo root memory, use the applicable ACTGDS/Superpowers workflow, execute only the authorized task, verify with fresh evidence, update current project memory, report, and stop.

## Common Mistakes

| Mistake | Correct response |
| --- | --- |
| Repeating permanent rules in every huge prompt | Put durable rules in `AGENTS.md`; keep task prompts focused |
| Trusting an agent's “PASS” report | Inspect diff and fresh CI/test evidence |
| Treating merge as completion | Require post-merge CI + memory guard |
| Copying an old staging SHA into living status | Fetch remote when the exact HEAD is needed |
| Assuming “next obvious step” is authorized | Report it, stop, and wait for Tony |
