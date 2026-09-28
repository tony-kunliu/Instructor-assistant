# Vendored Superpowers Skills — Source Record

These skill directories are vendored, unmodified, from the upstream
Superpowers project so that fresh Claude Code cloud sessions can discover
them via this repo's own `.claude/skills/` tree, without relying on
`~/.claude/plugins` or any account-level plugin install/persistence.

## Upstream

- **Repository:** https://github.com/obra/superpowers
- **Author:** Jesse Vincent
- **License:** MIT (see `SUPERPOWERS-LICENSE` in this directory — the
  original `LICENSE` file from the upstream repo, kept verbatim per the
  MIT license's notice-inclusion requirement)
- **Upstream revision vendored:** `8ca22dba9a94f28898bbce59f2537ff4d87c747`
  (commit dated 2026-09-25, plugin version `6.4.2` per upstream
  `.claude-plugin/plugin.json`)
- **Vendored:** 2026-09-28

## Skills vendored (13 of the upstream's 15)

Copied verbatim, directory and all (including any `scripts/`, `references/`,
or other supporting files each skill ships with) from upstream `skills/`:

- `using-superpowers`
- `brainstorming`
- `writing-plans`
- `systematic-debugging`
- `test-driven-development`
- `verification-before-completion`
- `requesting-code-review`
- `finishing-a-development-branch`
- `executing-plans`
- `dispatching-parallel-agents`
- `subagent-driven-development`
- `receiving-code-review`
- `using-git-worktrees`

Not vendored (not currently referenced by this repo's workflow routing):
`diagnosing-superpowers`, `writing-skills`.

## Registered skill names

Claude Code registers a repo-local skill (`.claude/skills/<dir>/SKILL.md`)
under the plain `name:` value from that file's frontmatter — there is no
`superpowers:` namespace prefix for repo-local skills (that prefix only
appears for skills delivered through an installed *plugin*). So each
vendored skill above is discoverable under its bare name, e.g.
`brainstorming`, `systematic-debugging`, `writing-plans`, etc. — matching
the directory name in every case here.

Any reference to `superpowers:<skill-name>` (e.g. in
`.claude/skills/actgds-development-workflow/SKILL.md`, once that file is
present on a given branch) must use the bare name instead, since the
`superpowers:` prefix does not exist for these vendored copies.

## Updating safely

1. Re-clone upstream: `git clone https://github.com/obra/superpowers`.
2. Diff the specific `skills/<name>/` directories listed above against
   this repo's `.claude/skills/<name>/` — do not blindly overwrite; check
   for upstream behavior changes that might interact with this repo's own
   `actgds-development-workflow` routing.
3. Copy the updated directory(ies) over, preserving the upstream content
   exactly (no renaming files, no rewriting instructions to "fit" this
   project — if something doesn't fit, that's a signal to reconsider using
   it, not to fork it silently).
4. Update the "Upstream revision vendored" commit hash and date above.
5. Keep `SUPERPOWERS-LICENSE` in place unmodified.
6. Re-run this repo's build/tests and the Project Memory Guard, then follow
   the normal `AGENTS.md` branch flow (`feature/*` → `staging`, Tony's
   authorization required for `main`/Production).

Do not vendor the full upstream repository — only the skills this repo's
workflow actually routes to. Adding a new skill later should follow the
same process: vendor only that skill's directory, record it here.
