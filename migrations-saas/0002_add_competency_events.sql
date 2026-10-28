-- Migration number: 0002
-- CBT&A V2 structured competency tracking (Taught / Assessed / Achieved
-- events per learner, per lesson) — see lib/competency.ts for the rules.
--
-- Must stay byte-for-byte identical to the corresponding block of
-- `SCHEMA_SQL` in lib/schema.ts — tests/d1-storage.test.ts checks that
-- migrations/0001_init.sql + migrations/0002_add_competency_events.sql
-- concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

CREATE TABLE IF NOT EXISTS competency_events (
  id             TEXT PRIMARY KEY,
  learner_id     TEXT NOT NULL REFERENCES learners (id),
  lesson_id      TEXT NOT NULL REFERENCES lessons (id),
  competency_id  TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('taught', 'assessed')),
  result         TEXT CHECK (result IN ('achieved', 'not_achieved')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS competency_events_learner_idx ON competency_events (learner_id, competency_id);
CREATE INDEX IF NOT EXISTS competency_events_lesson_idx ON competency_events (lesson_id);
