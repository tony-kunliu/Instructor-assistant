-- Migration number: 0011
-- Learner transfer to another instructor (learner management 3c, T1). Additive only: one new table, one
-- index. The learners table and all existing data are untouched (no ALTER, no backfill, no rebuild).
-- A transfer (POST /api/learners/[id]/transfer) changes ONLY learners.instructor_id (+ updated_at) and
-- writes one event row in the same atomic db.batch(); the event INSERT runs first and both statements
-- require instructor_id = from_instructor_id AND archived_at IS NULL (compare-and-set). Lessons keep
-- their own instructor_id (CoP 9.1 g / 9.2 d). records_checked_at/by record the receiving instructor's
-- one-tap "Checked" of the CoP 9.1 h / 9.2 e reminder. note is optional free text (<= 200 chars).
-- Never sent to ACTGDS; emits no outbox event (contract unchanged).
--
-- learner_transfer_events.learner_id references learners (id). Any later migration that rebuilds
-- learners must use the 0006 pattern (PRAGMA defer_foreign_keys = ON, copy to a backup table,
-- DROP, re-create, re-insert from the backup).
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0011 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

CREATE TABLE IF NOT EXISTS learner_transfer_events (
  id                  TEXT PRIMARY KEY,
  learner_id          TEXT NOT NULL REFERENCES learners (id),
  from_instructor_id  TEXT NOT NULL REFERENCES instructors (id),
  to_instructor_id    TEXT NOT NULL REFERENCES instructors (id),
  at                  TEXT NOT NULL,
  by_instructor_id    TEXT REFERENCES instructors (id),
  note                TEXT,
  records_checked_at  TEXT,
  records_checked_by  TEXT REFERENCES instructors (id)
);
CREATE INDEX IF NOT EXISTS learner_transfer_events_learner_idx ON learner_transfer_events (learner_id, at);
