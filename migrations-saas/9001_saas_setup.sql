-- Migration number: 9001
-- SaaS edition setup (SaaS D1 database ONLY; see
-- docs/superpowers/specs/2026-10-21-saas-edition-design.md §6). The private
-- databases never get this file: it lives only in migrations-saas/, which is
-- every migrations/ file copied byte for byte (tests/saas-migrations.test.ts
-- fails on any difference) plus SaaS-only 9xxx files that sort after them.
--
-- - Deletes the two seed instructors migrations/0004 inserts: the private
--   app's own accounts must not exist in the SaaS database. Safe because this
--   runs on a fresh, empty database where nothing references them (no
--   migration after 0004 inserts rows pointing at these ids).
-- - Drops the unique-name index: in the SaaS edition two unrelated
--   instructors may share a name.
-- - Adds a unique index on lower(email): the signed-in e-mail is what maps a
--   login to exactly one instructor.
--
-- Applied only by the SaaS deployment, whose D1 binding uses
-- migrations_dir = "migrations-saas" (wrangler orders files by name).

DELETE FROM instructors
WHERE id IN ('a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01', 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02');

DROP INDEX IF EXISTS instructors_name_idx;

CREATE UNIQUE INDEX IF NOT EXISTS instructors_email_idx ON instructors (lower(email));
