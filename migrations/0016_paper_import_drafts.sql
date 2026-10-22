-- Migration number: 0016
-- Saved CSV drafts for the paper-records import (Tony 2026-10-22): a CSV with rows that do not pass the import rules
-- is kept on the site per learner, so it can be corrected later (on the page, or by re-pasting) and imported once it
-- is clean. Nothing here is a record: the import itself is unchanged and still all-or-nothing, only into a learner with
-- no lessons. One draft per learner (saving again replaces it). Additive only: one new table, no change to existing ones.
--   csv_text                 the CSV as typed or pasted (<= 512 KB, the import limit)
--   saved_at                 ISO time of the last save
--   saved_by_instructor_id   the verified instructor who saved it (NULL when there is no sign-in, e.g. local dev)
-- Contains learner details like the records themselves; never sent to ACTGDS.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0016 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
CREATE TABLE IF NOT EXISTS paper_import_drafts (
  learner_id              TEXT PRIMARY KEY REFERENCES learners (id),
  csv_text                TEXT NOT NULL,
  saved_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  saved_by_instructor_id  TEXT REFERENCES instructors (id)
);
