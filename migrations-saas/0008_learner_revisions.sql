-- Migration number: 0008
-- Learner edit revisions (learner management Phase 1, decisions L2/L3/L5). Additive only: one new
-- table, one index. The learners table and all existing data are untouched.
-- Every successful learner edit (PATCH /api/learners/[id] with learner fields) stores a revision:
-- the learner's PREVIOUS values of every editable field (snapshot_json: fullName, address, phone,
-- dob, licenceNumber, licenceExpiry, eligibility, transmission, schoolWork, licenceStage), who
-- edited, and when. Written in the same atomic db.batch() as the UPDATE. Recorded only; no UI
-- displays it yet. instructor_id (transfer) is not editable in this phase.
--
-- learner_revisions.learner_id references learners (id). Any later migration that rebuilds
-- learners must use the 0006 pattern (PRAGMA defer_foreign_keys = ON, copy to a backup table,
-- DROP, re-create, re-insert from the backup).
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL — tests/d1-storage.test.ts
-- checks migrations/0001..0008 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

CREATE TABLE IF NOT EXISTS learner_revisions (
  id                       TEXT PRIMARY KEY,
  learner_id               TEXT NOT NULL REFERENCES learners (id),
  revision_no              INTEGER NOT NULL,
  edited_at                TEXT NOT NULL,
  edited_by_instructor_id  TEXT REFERENCES instructors (id),
  snapshot_json            TEXT NOT NULL,
  UNIQUE (learner_id, revision_no)
);
CREATE INDEX IF NOT EXISTS learner_revisions_learner_idx ON learner_revisions (learner_id, revision_no);
