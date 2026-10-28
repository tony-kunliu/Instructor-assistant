-- Migration number: 0010
-- Learner archive reason and restore history (learner management Phase 3b). Additive only: one new
-- table, one index. The learners table and all existing data are untouched (no ALTER, no backfill).
-- Every REAL archive / restore (PATCH /api/learners/[id] {archived}) writes one event row in the same
-- atomic db.batch() as the learners UPDATE; re-archiving an archived learner or restoring an active one
-- writes nothing. reason is one of the fixed presets in lib/archive-reasons.ts (or NULL = not given),
-- note is optional free text (<= 200 chars). Learners archived before this migration have no event
-- row and simply show no reason (none is ever invented). Never sent to ACTGDS; emits no outbox event.
--
-- learner_archive_events.learner_id references learners (id). Any later migration that rebuilds
-- learners must use the 0006 pattern (PRAGMA defer_foreign_keys = ON, copy to a backup table,
-- DROP, re-create, re-insert from the backup).
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0010 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

CREATE TABLE IF NOT EXISTS learner_archive_events (
  id                TEXT PRIMARY KEY,
  learner_id        TEXT NOT NULL REFERENCES learners (id),
  action            TEXT NOT NULL CHECK (action IN ('archived', 'restored')),
  reason            TEXT,
  note              TEXT,
  at                TEXT NOT NULL,
  by_instructor_id  TEXT REFERENCES instructors (id)
);
CREATE INDEX IF NOT EXISTS learner_archive_events_learner_idx ON learner_archive_events (learner_id, at);
