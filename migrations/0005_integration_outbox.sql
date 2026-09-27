-- Migration number: 0005
-- ACTGDS Integration V1 — durable outbox for lesson.upserted events (see
-- docs/integrations/actgds-instructor-assistant-v1.md).
--
-- A lesson save/edit must never fail because the website integration is
-- down or unconfigured (AGENTS.md §10). So a lesson write enqueues a row
-- here in the SAME db.batch() transaction as the lesson/competency_events
-- write (see lib/repo.ts) — the enqueue succeeds or fails together with the
-- lesson save, but actually delivering the webhook happens asynchronously,
-- entirely decoupled from the user-visible save.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL — tests/d1-storage.test.ts
-- checks migrations/0001..0005 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

CREATE TABLE IF NOT EXISTS integration_outbox (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  learner_id        TEXT NOT NULL,
  lesson_id         TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'permanent_failure')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error_code   TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at      TEXT
);
CREATE INDEX IF NOT EXISTS integration_outbox_status_idx ON integration_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS integration_outbox_lesson_idx ON integration_outbox (lesson_id);
