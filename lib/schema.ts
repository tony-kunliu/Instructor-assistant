// Database schema (SQLite). Plain SQL so it can later be applied unchanged to
// Cloudflare D1, the database used by the main ACTGDS website.
//
// Designed to grow without breaking changes:
//  - learners.licence_stage   → Driving Journey (learner → P1 → P2 → full)
//  - lessons.id / learners.id → future bookings, CRM notes, learner & parent
//                               accounts reference these ids.
// None of those features exist yet.

export const SCHEMA_VERSION = 2;

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
`;
