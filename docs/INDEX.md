# Documentation Index

Start with the repo root docs, in this order:

1. `README.md` — what this is, stack, local dev, verification, branch flow.
2. `AGENTS.md` — permanent working rules for every human/AI agent in this repo.
3. `STATUS.md` — current state: branches, deployed environments, Integration status, known issues.
4. `TASK.md` — current task, its status, and the next recommended step.

## Everything else

- `docs/ECOSYSTEM_ROADMAP.md` — longer-term shared direction between this
  repo and the ACTGDS Website (`tony-kunliu/actgds.com`).
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
