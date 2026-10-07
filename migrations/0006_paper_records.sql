-- Migration number: 0006
-- P1b Paper Records Import — a lesson row can now represent a historical
-- paper-logbook lesson. Start/finish time, odometer, duration and distance
-- become nullable (a paper record may not have them), and two new columns
-- say where the row came from (record_source) and how it was signed
-- (signature_status). Existing rows become 'app' / 'digital' via defaults.
--
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt.
-- competency_events.lesson_id references lessons (id), so the rebuild sets
-- defer_foreign_keys (D1's documented way) and copies rows via a backup
-- table: dropping the parent and re-inserting its rows into the re-created
-- table clears the deferred FK violations before commit (a lessons_new +
-- RENAME rebuild leaves them uncleared and fails at COMMIT). Every column
-- is copied with an explicit list.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL — tests/d1-storage.test.ts
-- checks migrations/0001..0006 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

PRAGMA defer_foreign_keys = ON;

CREATE TABLE lessons_backup AS SELECT * FROM lessons;

DROP TABLE lessons;

CREATE TABLE lessons (
  id                       TEXT PRIMARY KEY,
  learner_id               TEXT NOT NULL REFERENCES learners (id),
  instructor_id            TEXT NOT NULL REFERENCES instructors (id),
  lesson_no                INTEGER NOT NULL,
  lesson_date              TEXT NOT NULL,
  start_time               TEXT,
  finish_time              TEXT,
  start_odometer           INTEGER,
  finish_odometer          INTEGER,
  duration_minutes         INTEGER,
  distance_km              INTEGER,
  cumulative_minutes       INTEGER NOT NULL,
  cumulative_km            INTEGER NOT NULL,
  taught                   TEXT,
  competencies_assessed    TEXT,
  achieved                 TEXT,
  location                 TEXT,
  comments                 TEXT,
  adi_signature            TEXT,
  learner_signature        TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT,
  updated_by_instructor_id TEXT REFERENCES instructors (id),
  record_source            TEXT NOT NULL DEFAULT 'app' CHECK (record_source IN ('app', 'paper_import')),
  signature_status         TEXT NOT NULL DEFAULT 'digital' CHECK (signature_status IN ('digital', 'on_paper', 'unsigned')),
  UNIQUE (learner_id, lesson_no)
);

INSERT INTO lessons (
  id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time,
  start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km,
  taught, competencies_assessed, achieved, location, comments, adi_signature, learner_signature,
  created_at, updated_at, updated_by_instructor_id
)
SELECT
  id, learner_id, instructor_id, lesson_no, lesson_date, start_time, finish_time,
  start_odometer, finish_odometer, duration_minutes, distance_km, cumulative_minutes, cumulative_km,
  taught, competencies_assessed, achieved, location, comments, adi_signature, learner_signature,
  created_at, updated_at, updated_by_instructor_id
FROM lessons_backup;

DROP TABLE lessons_backup;
