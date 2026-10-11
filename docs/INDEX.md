# Documentation Index

Start with the repo root docs, in this order:

1. `README.md` — what this is, stack, local dev, verification, branch flow.
2. `AGENTS.md` — permanent working rules for every human/AI agent in this repo.
3. `STATUS.md` — current state: branches, deployed environments, Integration status, known issues.
4. `TASK.md` — current task, its status, and the next recommended step.

## Everything else

- `docs/OPERATING_HANDBOOK.md` — Operating Handbook v2 for both repos (IA +
  ACTGDS Website): principles, roles, independent review, ALWAYS-ASK-TONY list,
  risk tiers, delivery flow, checklists, open decisions. Draft for Tony.
- `docs/ACT_ASSESSMENT_STANDARDS.md` — rules from the current ACT Assessment
  Standards (NI2020-703) and Code of Practice (DI2020-294) the app must respect.
- `docs/ECOSYSTEM_ROADMAP.md` — longer-term shared direction between this
  repo and the ACTGDS Website (`tony-kunliu/actgds.com`).
- `docs/BACKLOG.md` — features not built yet, with where each is designed.
- `docs/RELEASE_B_RUNBOOK.md` — Production Integration enablement
  (Release B) preconditions, steps and rollback.
- `docs/integrations/actgds-instructor-assistant-v1.md` — the
  `actgds-instructor-assistant/v1` Integration contract (human-readable
  companion to the JSON Schema).
- `docs/integrations/lesson-upserted-v1.schema.json` — the canonical
  `lesson.upserted` event JSON Schema. **Never edit without a matching
  handshake/hash ACK from the ACTGDS repo** — see `AGENTS.md` §10.
- `docs/integrations/lesson-upserted-v1.fixtures.json` — shared test
  fixtures, kept byte-identical to the ACTGDS repo's copy.

Cross-repo coordination for the Integration contract happens in
`tony-kunliu/actgds.com` Issue #3.
