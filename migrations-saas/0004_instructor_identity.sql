-- Migration number: 0004
-- Instructor Identity V1 (data model only this round — Cloudflare Access
-- itself is deferred until Tony completes the one-time Zero Trust enable in
-- the Cloudflare dashboard; see STATUS.md).
--
-- Adds:
--   instructors.status               — 'active' | 'inactive', app-validated
--                                       (not a DB CHECK — SQLite ALTER TABLE
--                                       ADD COLUMN keeps that simple).
--   lessons.updated_by_instructor_id — which instructor last edited a
--                                       history lesson (NULL until edited by
--                                       an attributed instructor).
--
-- Seeds the first two named instructors, Tony and Anna, with their real
-- login email (provided by Tony directly in this session, for the
-- Cloudflare Access allow-list and email→instructor mapping once Access is
-- wired up). This does NOT touch or rename any existing instructor row
-- (e.g. "ADI601", "ADI604") — those keep their original attribution
-- untouched, per instruction not to guess/rewrite historical data.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL — tests/d1-storage.test.ts
-- checks migrations/0001+0002+0003+0004 concatenated equal SCHEMA_SQL.

ALTER TABLE instructors ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE lessons ADD COLUMN updated_by_instructor_id TEXT REFERENCES instructors (id);

INSERT INTO instructors (id, full_name, email, status)
VALUES
  ('a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', 'Tony', 'Kunliu.work@gmail.com', 'active'),
  ('a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02', 'Anna', 'yapingqu.work@gmail.com', 'active')
ON CONFLICT (id) DO UPDATE SET email = excluded.email, status = excluded.status;
