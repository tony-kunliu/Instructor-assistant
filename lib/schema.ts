// Database schema (SQLite). Plain SQL so it can later be applied unchanged to
// Cloudflare D1, the database used by the main ACTGDS website.
//
// Designed to grow without breaking changes:
//  - learners.licence_stage   → Driving Journey (learner → P1 → P2 → full)
//  - lessons.id / learners.id → future bookings, CRM notes, learner & parent
//                               accounts reference these ids.
// None of those features exist yet.

export const SCHEMA_VERSION = 11;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS instructors (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL,
  adi_number  TEXT,
  phone       TEXT,
  email       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS instructors_name_idx ON instructors (lower(full_name));

CREATE TABLE IF NOT EXISTS learners (
  id              TEXT PRIMARY KEY,
  instructor_id   TEXT NOT NULL REFERENCES instructors (id),
  full_name       TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  dob             TEXT,
  licence_number  TEXT,
  licence_expiry  TEXT,
  eligibility     TEXT,
  transmission    TEXT CHECK (transmission IN ('manual', 'auto')),
  school_work     TEXT,
  licence_stage   TEXT NOT NULL DEFAULT 'learner' CHECK (licence_stage IN ('learner', 'p1', 'p2', 'full')),
  archived_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS learners_instructor_idx ON learners (instructor_id);

CREATE TABLE IF NOT EXISTS lessons (
  id                     TEXT PRIMARY KEY,
  learner_id             TEXT NOT NULL REFERENCES learners (id),
  instructor_id          TEXT NOT NULL REFERENCES instructors (id),
  lesson_no              INTEGER NOT NULL,
  lesson_date            TEXT NOT NULL,
  start_time             TEXT NOT NULL,
  finish_time            TEXT NOT NULL,
  start_odometer         INTEGER NOT NULL,
  finish_odometer        INTEGER NOT NULL,
  duration_minutes       INTEGER NOT NULL,
  distance_km            INTEGER NOT NULL,
  cumulative_minutes     INTEGER NOT NULL,
  cumulative_km          INTEGER NOT NULL,
  taught                 TEXT,
  competencies_assessed  TEXT,
  achieved               TEXT,
  location               TEXT,
  comments               TEXT,
  adi_signature          TEXT,
  learner_signature      TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (learner_id, lesson_no)
);

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

ALTER TABLE lessons ADD COLUMN updated_at TEXT;

ALTER TABLE instructors ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE lessons ADD COLUMN updated_by_instructor_id TEXT REFERENCES instructors (id);

INSERT INTO instructors (id, full_name, email, status)
VALUES
  ('a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', 'Tony', 'Kunliu.work@gmail.com', 'active'),
  ('a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02', 'Anna', 'yapingqu.work@gmail.com', 'active')
ON CONFLICT (id) DO UPDATE SET email = excluded.email, status = excluded.status;

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
  record_source            TEXT NOT NULL DEFAULT 'app' CHECK (record_source IN ('app', 'paper_import', 'prior_instructor')),
  signature_status         TEXT NOT NULL DEFAULT 'digital' CHECK (signature_status IN ('digital', 'on_paper', 'unsigned')),
  prior_instructor_label   TEXT,
  prior_lesson_count       INTEGER,
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

CREATE TABLE IF NOT EXISTS lesson_revisions (
  id                       TEXT PRIMARY KEY,
  lesson_id                TEXT NOT NULL REFERENCES lessons (id),
  revision_no              INTEGER NOT NULL,
  edited_at                TEXT NOT NULL,
  edited_by_instructor_id  TEXT REFERENCES instructors (id),
  reason                   TEXT,
  snapshot_json            TEXT NOT NULL,
  UNIQUE (lesson_id, revision_no)
);
CREATE INDEX IF NOT EXISTS lesson_revisions_lesson_idx ON lesson_revisions (lesson_id, revision_no);

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

ALTER TABLE learners ADD COLUMN learner_licence_issued_on TEXT;
ALTER TABLE learners ADD COLUMN learner_licence_first_issued_on TEXT;
ALTER TABLE learners ADD COLUMN hpt_passed_on TEXT;
ALTER TABLE learners ADD COLUMN logged_hours INTEGER;
ALTER TABLE learners ADD COLUMN logged_hours_on TEXT;

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
`;
